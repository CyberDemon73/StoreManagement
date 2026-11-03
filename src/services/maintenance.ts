import { del, list, put } from '@vercel/blob';
import { and, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { failedLogins, idempotencyKeys, notifications, passwordResetTokens, sessions, users } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { buildDataExport } from './data-export';
import { notifyAdmins } from './notifications';
import { getSettings } from './settings';
import { verifyStock } from './stock-verify';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Retention thresholds; rows strictly older than these are deleted. */
export const RETENTION = {
  tokensMs: 7 * DAY,
  idempotencyMs: 48 * HOUR,
  readNotificationsMs: 90 * DAY,
  failedLoginsMs: DAY,
} as const;

export interface PurgeCounts {
  tokens: number;
  sessions: number;
  idempotencyKeys: number;
  notifications: number;
  failedLogins: number;
}

export type BackupResult = { status: 'uploaded'; path: string; pruned: number } | { status: 'skipped'; reason: string } | { status: 'failed' };

export interface MaintenanceResult {
  purged: PurgeCounts;
  /** True when it is Sunday in the store timezone: the stock reconciliation ran. */
  weekly: boolean;
  stockVerify?: { ok: boolean; mismatches: number };
  backup?: BackupResult;
}

const BACKUP_PREFIX = 'backups/';
/** The one backup file: every daily run overwrites it, so the store always holds exactly the latest. */
export const BACKUP_PATH = `${BACKUP_PREFIX}latest.zip`;

interface BlobOpts {
  token: string | undefined;
}
export interface BackupBlob {
  pathname: string;
  url: string;
  uploadedAt: Date;
}
export interface BackupStore {
  write: (pathname: string, body: Uint8Array, opts: BlobOpts) => Promise<unknown>;
  list: (opts: BlobOpts & { prefix: string }) => Promise<BackupBlob[]>;
  del: (urls: string[], opts: BlobOpts) => Promise<unknown>;
}

const blobStore: BackupStore = {
  // Backups hold every customer phone and cost price: private blob, never public.
  write: (path, body, { token }) =>
    put(path, Buffer.from(body), { access: 'private', contentType: 'application/zip', addRandomSuffix: false, allowOverwrite: true, token }),
  list: async ({ prefix, token }) => {
    const out: BackupBlob[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, token, cursor });
      out.push(...page.blobs.map((b) => ({ pathname: b.pathname, url: b.url, uploadedAt: new Date(b.uploadedAt) })));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  del: (urls, { token }) => del(urls, { token }),
};

let testStore: BackupStore | null = null;

/**
 * Test seam: capture backup uploads (and fake list/delete) instead of calling Vercel Blob.
 * `list` defaults to an empty store and `del` to a no-op. Pass null to restore.
 */
export function setBackupStoreForTests(store: (Pick<BackupStore, 'write'> & Partial<BackupStore>) | null): void {
  testStore = store ? { list: async () => [], del: async () => undefined, ...store } : null;
}

const before = (now: Date, ms: number) => new Date(now.getTime() - ms);

export async function purgeStale(db: Db, now: Date): Promise<PurgeCounts> {
  const tokenCut = before(now, RETENTION.tokensMs);
  const tokens = await db
    .delete(passwordResetTokens)
    .where(
      and(
        or(lt(passwordResetTokens.expiresAt, tokenCut), lt(passwordResetTokens.usedAt, tokenCut)),
        // An INVITE token row is the "never accepted" signal (DECISIONS 2026-11-06): keep it
        // until the invitee has signed in at least once.
        or(
          ne(passwordResetTokens.purpose, 'INVITE'),
          sql`exists (select 1 from ${users} where ${users.id} = ${passwordResetTokens.userId} and ${users.lastLoginAt} is not null)`,
        ),
      ),
    )
    .returning({ id: passwordResetTokens.id });

  // Revocation deletes the row, so "expired" covers everything else; the absolute cut uses the
  // current setting so lowering sessionAbsoluteDays also ends sessions minted under the old value.
  const { sessionAbsoluteDays } = await getSettings(db);
  const deadSessions = await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, now), lt(sessions.idleExpiresAt, now), lt(sessions.createdAt, before(now, sessionAbsoluteDays * DAY))))
    .returning({ id: sessions.id });

  const keys = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, before(now, RETENTION.idempotencyMs)))
    .returning({ key: idempotencyKeys.key });

  const notes = await db
    .delete(notifications)
    .where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, before(now, RETENTION.readNotificationsMs))))
    .returning({ id: notifications.id });

  const logins = await db
    .delete(failedLogins)
    .where(
      and(
        lt(failedLogins.updatedAt, before(now, RETENTION.failedLoginsMs)),
        or(isNull(failedLogins.lockedUntil), lt(failedLogins.lockedUntil, now)),
      ),
    )
    .returning({ email: failedLogins.email });

  return {
    tokens: tokens.length,
    sessions: deadSessions.length,
    idempotencyKeys: keys.length,
    notifications: notes.length,
    failedLogins: logins.length,
  };
}

/** Local calendar date (YYYY-MM-DD) and whether it is Sunday in `tz`. */
export function isStoreSunday(now: Date, tz: string): { sunday: boolean; localDate: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { sunday: get('weekday') === 'Sun', localDate: `${get('year')}-${get('month')}-${get('day')}` };
}

async function weeklyStockVerify(db: Db, localDate: string): Promise<{ ok: boolean; mismatches: number }> {
  const { ok, mismatches } = await verifyStock(db);
  if (!ok) {
    logger.error({ mismatches: mismatches.length }, 'stock:verify found ledger mismatches');
    await notifyAdmins(db, {
      kind: 'SYSTEM',
      title: `Stock check: ${mismatches.length} variant(s) out of sync`,
      body: `The weekly stock check found ${mismatches.length} variant(s) whose quantity does not match the movement ledger. Run a stock count for them.`,
      href: '/stock',
      dedupeKey: `stock-verify:${localDate}`,
      payload: { mismatches: mismatches.slice(0, 50) },
    });
  }
  return { ok, mismatches: mismatches.length };
}

const errInfo = (err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  return { name: e.name, message: e.message };
};

/** Removes every other file under backups/ (e.g. older dated backups). Best effort: never fails the backup. */
async function pruneBackups(store: BackupStore, opts: BlobOpts, keep: string): Promise<number> {
  try {
    const old = (await store.list({ ...opts, prefix: BACKUP_PREFIX })).filter((b) => b.pathname.startsWith(BACKUP_PREFIX) && b.pathname !== keep);
    if (old.length === 0) return 0;
    await store.del(
      old.map((b) => b.url),
      opts,
    );
    return old.length;
  } catch (err) {
    logger.error({ err: errInfo(err) }, 'backup prune failed');
    return 0;
  }
}

async function dailyBackup(db: Db, localDate: string): Promise<BackupResult> {
  const env = getEnv();
  // Product images use a public store; backups must go to a separate private one when configured.
  const token = env.BACKUP_BLOB_READ_WRITE_TOKEN ?? env.BLOB_READ_WRITE_TOKEN;
  if (!testStore && !token) return { status: 'skipped', reason: 'BACKUP_BLOB_READ_WRITE_TOKEN / BLOB_READ_WRITE_TOKEN not set' };
  const store = testStore ?? blobStore;
  const path = BACKUP_PATH;
  try {
    // Rows are paged through the streamed export; only the compressed zip is collected here.
    const { zip } = await buildDataExport(db);
    await store.write(path, zip, { token });
  } catch (err) {
    logger.error({ err: errInfo(err) }, 'daily backup upload failed');
    await notifyAdmins(db, {
      kind: 'SYSTEM',
      title: 'Daily backup failed',
      body: 'Today\'s data backup could not be uploaded. Download a data export from Settings, and check that the backup Blob store is private and its token (BACKUP_BLOB_READ_WRITE_TOKEN) is valid.',
      href: '/settings',
      dedupeKey: `backup-failed:${localDate}`,
    });
    return { status: 'failed' };
  }
  const pruned = await pruneBackups(store, { token }, path);
  return { status: 'uploaded', path, pruned };
}

/**
 * Daily: purge stale rows and overwrite the private backup (backups/latest.zip).
 * Sundays (store timezone): also the stock reconciliation.
 */
export async function runDailyMaintenance(db: Db, now: Date): Promise<MaintenanceResult> {
  const purged = await purgeStale(db, now);
  const { timezone } = await getSettings(db);
  const { sunday, localDate } = isStoreSunday(now, timezone);
  const stockVerify = sunday ? await weeklyStockVerify(db, localDate) : undefined;
  const backup = await dailyBackup(db, localDate);
  return { purged, weekly: sunday, ...(stockVerify ? { stockVerify } : {}), backup };
}
