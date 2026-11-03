import { put } from '@vercel/blob';
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

export type BackupResult = { status: 'uploaded'; path: string } | { status: 'skipped'; reason: string } | { status: 'failed' };

export interface MaintenanceResult {
  purged: PurgeCounts;
  /** True when it is Sunday in the store timezone: stock verify + backup ran. */
  weekly: boolean;
  stockVerify?: { ok: boolean; mismatches: number };
  backup?: BackupResult;
}

export type BackupWriter = (pathname: string, body: Uint8Array) => Promise<unknown>;

let testWriter: BackupWriter | null = null;

/** Test seam: capture backup uploads instead of calling Vercel Blob. Pass null to restore. */
export function setBackupWriterForTests(fn: BackupWriter | null): void {
  testWriter = fn;
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

async function weeklyBackup(db: Db, localDate: string): Promise<BackupResult> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!testWriter && !token) return { status: 'skipped', reason: 'BLOB_READ_WRITE_TOKEN not set' };
  const path = `backups/${localDate}.zip`;
  try {
    const { zip } = await buildDataExport(db);
    if (testWriter) await testWriter(path, zip);
    // Backups hold every customer phone and cost price: private blob, never public.
    else await put(path, Buffer.from(zip), { access: 'private', contentType: 'application/zip', addRandomSuffix: false, allowOverwrite: true, token });
    return { status: 'uploaded', path };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error({ err: { name: e.name, message: e.message } }, 'weekly backup upload failed');
    await notifyAdmins(db, {
      kind: 'SYSTEM',
      title: 'Weekly backup failed',
      body: 'The weekly data backup could not be uploaded. Download a data export from Settings and check the Vercel Blob store.',
      href: '/settings',
      dedupeKey: `backup-failed:${localDate}`,
    });
    return { status: 'failed' };
  }
}

/** Daily: purge stale rows. Sundays (store timezone): stock reconciliation + private backup. */
export async function runDailyMaintenance(db: Db, now: Date): Promise<MaintenanceResult> {
  const purged = await purgeStale(db, now);
  const { timezone } = await getSettings(db);
  const { sunday, localDate } = isStoreSunday(now, timezone);
  if (!sunday) return { purged, weekly: false };
  const stockVerify = await weeklyStockVerify(db, localDate);
  const backup = await weeklyBackup(db, localDate);
  return { purged, weekly: true, stockVerify, backup };
}
