import { eq, sql } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { failedLogins, idempotencyKeys, notifications, passwordResetTokens, sessions, users, variants } from '@/db/schema';
import { resetEnvForTests } from '@/lib/env';
import { BACKUP_RETENTION_MS, isStoreSunday, purgeStale, runDailyMaintenance, setBackupStoreForTests } from '@/services/maintenance';
import { ensureSettings } from '@/services/settings';
import { stockFixture } from '../helpers/stock';
import { createUser } from '../helpers/users';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MIN = 60_000;
// 2026-11-08 is a Sunday; 02:00 UTC is 04:00 in Africa/Cairo.
const SUNDAY = new Date('2026-11-08T02:00:00Z');
const SATURDAY = new Date('2026-11-07T02:00:00Z');
const NOW = SATURDAY;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = '';
  process.env.BACKUP_BLOB_READ_WRITE_TOKEN = '';
  resetEnvForTests();
});
afterEach(() => setBackupStoreForTests(null));

async function ids<T extends { id: string }>(rows: Promise<T[]>) {
  return (await rows).map((r) => r.id).sort();
}

describe('purgeStale', () => {
  it('reset tokens: expired or used more than 7 days ago are purged; pending invites are kept', async () => {
    const db = getDb();
    const active = await createUser(db, { role: 'SELLER' });
    await db.update(users).set({ lastLoginAt: ago(DAY) }).where(eq(users.id, active.id));
    const pending = await createUser(db, { role: 'SELLER' });
    const mk = (userId: string, tag: string, purpose: 'RESET' | 'INVITE', expiresAt: Date, usedAt: Date | null = null) =>
      db.insert(passwordResetTokens).values({ userId, tokenHash: tag, purpose, expiresAt, usedAt }).returning({ id: passwordResetTokens.id });
    const [expiredOld] = await mk(active.id, 'expired-old', 'RESET', ago(7 * DAY + MIN));
    const [expiredRecent] = await mk(active.id, 'expired-recent', 'RESET', ago(7 * DAY - MIN));
    const [usedOld] = await mk(active.id, 'used-old', 'RESET', ago(-DAY), ago(7 * DAY + MIN));
    const [usedRecent] = await mk(active.id, 'used-recent', 'RESET', ago(7 * DAY - 2 * DAY), ago(7 * DAY - MIN));
    const [live] = await mk(active.id, 'live', 'RESET', ago(-HOUR));
    const [inviteAccepted] = await mk(active.id, 'invite-accepted', 'INVITE', ago(30 * DAY), ago(30 * DAY));
    const [invitePending] = await mk(pending.id, 'invite-pending', 'INVITE', ago(30 * DAY));

    const out = await purgeStale(db, NOW);
    expect(out.tokens).toBe(3);
    const left = await ids(db.select({ id: passwordResetTokens.id }).from(passwordResetTokens));
    expect(left).toEqual([expiredRecent!.id, usedRecent!.id, live!.id, invitePending!.id].sort());
    expect(left).not.toContain(expiredOld!.id);
    expect(left).not.toContain(usedOld!.id);
    expect(left).not.toContain(inviteAccepted!.id);
  });

  it('sessions: expired, idle-expired, and older than the current sessionAbsoluteDays are revoked', async () => {
    const db = getDb();
    await ensureSettings(db, { sessionAbsoluteDays: 7 });
    const u = await createUser(db, { role: 'SELLER' });
    const mk = (id: string, createdAt: Date, expiresAt: Date, idleExpiresAt: Date) =>
      db.insert(sessions).values({ id, userId: u.id, createdAt, lastSeenAt: createdAt, expiresAt, idleExpiresAt });
    const future = ago(-DAY);
    await mk('fresh', ago(HOUR), future, future);
    await mk('expired', ago(DAY), ago(MIN), future);
    await mk('idle-expired', ago(DAY), future, ago(MIN));
    await mk('just-inside-absolute', ago(7 * DAY - MIN), ago(-30 * DAY), future);
    await mk('beyond-absolute', ago(7 * DAY + MIN), ago(-30 * DAY), future);

    const out = await purgeStale(db, NOW);
    expect(out.sessions).toBe(3);
    const left = (await db.select({ id: sessions.id }).from(sessions)).map((r) => r.id).sort();
    expect(left).toEqual(['fresh', 'just-inside-absolute']);
  });

  it('idempotency keys older than 48 h are purged', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const mk = (key: string, createdAt: Date) =>
      db.insert(idempotencyKeys).values({ userId: u.id, route: 'POST /sales', key, requestHash: 'h', status: 201, response: {}, createdAt });
    await mk('old', ago(48 * HOUR + MIN));
    await mk('young', ago(48 * HOUR - MIN));
    const out = await purgeStale(db, NOW);
    expect(out.idempotencyKeys).toBe(1);
    expect((await db.select({ key: idempotencyKeys.key }).from(idempotencyKeys)).map((r) => r.key)).toEqual(['young']);
  });

  it('read notifications older than 90 days are purged; unread ones are kept whatever their age', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'ADMIN' });
    const mk = (title: string, createdAt: Date, readAt: Date | null) =>
      db.insert(notifications).values({ userId: u.id, kind: 'LOW_STOCK', title, body: 'b', createdAt, readAt });
    await mk('read-old', ago(90 * DAY + MIN), ago(90 * DAY));
    await mk('read-young', ago(90 * DAY - MIN), ago(DAY));
    await mk('unread-old', ago(400 * DAY), null);
    const out = await purgeStale(db, NOW);
    expect(out.notifications).toBe(1);
    expect((await db.select({ t: notifications.title }).from(notifications)).map((r) => r.t).sort()).toEqual(['read-young', 'unread-old']);
  });

  it('failed-login counters untouched for 24 h are purged unless still locked', async () => {
    const db = getDb();
    const mk = (email: string, updatedAt: Date, lockedUntil: Date | null = null) =>
      db.insert(failedLogins).values({ email, count: 3, updatedAt, lockedUntil });
    await mk('old@example.com', ago(DAY + MIN));
    await mk('young@example.com', ago(DAY - MIN));
    await mk('locked@example.com', ago(2 * DAY), ago(-HOUR));
    const out = await purgeStale(db, NOW);
    expect(out.failedLogins).toBe(1);
    expect((await db.select({ e: failedLogins.email }).from(failedLogins)).map((r) => r.e).sort()).toEqual(['locked@example.com', 'young@example.com']);
  });
});

describe('isStoreSunday', () => {
  it('uses the store timezone, not UTC', () => {
    expect(isStoreSunday(SUNDAY, 'Africa/Cairo')).toEqual({ sunday: true, localDate: '2026-11-08' });
    expect(isStoreSunday(SATURDAY, 'Africa/Cairo')).toEqual({ sunday: false, localDate: '2026-11-07' });
    // Saturday 23:30 UTC is already Sunday 01:30 in Cairo.
    expect(isStoreSunday(new Date('2026-11-07T23:30:00Z'), 'Africa/Cairo')).toEqual({ sunday: true, localDate: '2026-11-08' });
    // Sunday 02:00 UTC is still Saturday evening in Los Angeles.
    expect(isStoreSunday(SUNDAY, 'America/Los_Angeles').sunday).toBe(false);
  });
});

describe('runDailyMaintenance weekly work', () => {
  async function corrupt() {
    const db = getDb();
    const admin1 = await createUser(db, { role: 'ADMIN' });
    const admin2 = await createUser(db, { role: 'ADMIN' });
    const manager = await createUser(db, { role: 'MANAGER' });
    const fx = await stockFixture(db, admin1.id);
    // Simulate drift outside applyMovement() to exercise the reconciliation alarm.
    await db.execute(sql`update ${variants} set quantity = 99 where id = ${fx.variants[0].id}`);
    return { db, admin1, admin2, manager, fx };
  }

  async function systemFor(userId: string) {
    return getDb().select().from(notifications).where(eq(notifications.userId, userId));
  }

  it('Sunday mismatch → exactly one SYSTEM notification per admin (deduped across reruns), none for managers', async () => {
    const { db, admin1, admin2, manager } = await corrupt();
    const out = await runDailyMaintenance(db, SUNDAY);
    expect(out.weekly).toBe(true);
    expect(out.stockVerify).toEqual({ ok: false, mismatches: 1 });
    await runDailyMaintenance(db, SUNDAY);

    for (const a of [admin1, admin2]) {
      const rows = (await systemFor(a.id)).filter((n) => n.kind === 'SYSTEM' && n.dedupeKey === 'stock-verify:2026-11-08');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.title).toMatch(/stock/i);
    }
    expect((await systemFor(manager.id)).filter((n) => n.kind === 'SYSTEM')).toHaveLength(0);
  });

  it('Sunday with a consistent ledger → no SYSTEM notification', async () => {
    const db = getDb();
    const admin = await createUser(db, { role: 'ADMIN' });
    await stockFixture(db, admin.id);
    const out = await runDailyMaintenance(db, SUNDAY);
    expect(out.stockVerify).toEqual({ ok: true, mismatches: 0 });
    expect(await systemFor(admin.id)).toHaveLength(0);
  });

  it('not Sunday → no verify and no backup', async () => {
    const { db, admin1 } = await corrupt();
    const writes: string[] = [];
    setBackupStoreForTests({
      write: async (path) => {
        writes.push(path);
      },
    });
    const out = await runDailyMaintenance(db, SATURDAY);
    expect(out.weekly).toBe(false);
    expect(out.stockVerify).toBeUndefined();
    expect(out.backup).toBeUndefined();
    expect(writes).toEqual([]);
    expect(await systemFor(admin1.id)).toHaveLength(0);
  });

  it('Sunday backup: the data-export zip is written to backups/<local date>.zip', async () => {
    const db = getDb();
    const admin = await createUser(db, { role: 'ADMIN' });
    const writes: { path: string; body: Uint8Array }[] = [];
    setBackupStoreForTests({
      write: async (path, body) => {
        writes.push({ path, body });
      },
    });
    const out = await runDailyMaintenance(db, SUNDAY);
    expect(out.backup).toEqual({ status: 'uploaded', path: 'backups/2026-11-08.zip', pruned: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe('backups/2026-11-08.zip');
    const files = unzipSync(writes[0]!.body);
    expect(strFromU8(files['users.csv']!)).toContain(admin.email);
    expect(files['sessions.csv']).toBeUndefined();
  });

  it('Sunday backup is skipped cleanly when BLOB_READ_WRITE_TOKEN is unset', async () => {
    const db = getDb();
    await createUser(db, { role: 'ADMIN' });
    const out = await runDailyMaintenance(db, SUNDAY);
    expect(out.backup).toEqual({ status: 'skipped', reason: 'BACKUP_BLOB_READ_WRITE_TOKEN / BLOB_READ_WRITE_TOKEN not set' });
  });

  it('a failing backup upload does not fail the run; admins get one SYSTEM alert', async () => {
    const db = getDb();
    const admin = await createUser(db, { role: 'ADMIN' });
    setBackupStoreForTests({
      write: async () => {
        throw new Error('private access not enabled for this store');
      },
    });
    const out = await runDailyMaintenance(db, SUNDAY);
    expect(out.backup).toEqual({ status: 'failed' });
    const rows = (await systemFor(admin.id)).filter((n) => n.kind === 'SYSTEM');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupeKey).toBe('backup-failed:2026-11-08');
    expect(rows[0]!.body).not.toContain('private access');
    expect(rows[0]!.body).toContain('check that the backup Blob store is private');
  });

  it('uses BACKUP_BLOB_READ_WRITE_TOKEN when set, passed explicitly to upload and prune', async () => {
    const db = getDb();
    await createUser(db, { role: 'ADMIN' });
    process.env.BLOB_READ_WRITE_TOKEN = 'images-store-token';
    process.env.BACKUP_BLOB_READ_WRITE_TOKEN = 'private-backup-store-token';
    resetEnvForTests();
    const tokens: (string | undefined)[] = [];
    setBackupStoreForTests({
      write: async (_p, _b, opts) => {
        tokens.push(opts.token);
      },
      list: async (opts) => {
        tokens.push(opts.token);
        return [];
      },
    });
    await runDailyMaintenance(db, SUNDAY);
    expect(tokens).toEqual(['private-backup-store-token', 'private-backup-store-token']);
  });

  it('falls back to BLOB_READ_WRITE_TOKEN when no backup-specific token is set', async () => {
    const db = getDb();
    await createUser(db, { role: 'ADMIN' });
    process.env.BLOB_READ_WRITE_TOKEN = 'images-store-token';
    resetEnvForTests();
    const tokens: (string | undefined)[] = [];
    setBackupStoreForTests({
      write: async (_p, _b, opts) => {
        tokens.push(opts.token);
      },
    });
    const out = await runDailyMaintenance(db, SUNDAY);
    expect(out.backup?.status).toBe('uploaded');
    expect(tokens).toEqual(['images-store-token']);
  });

  it('after a successful upload, backups older than 12 weeks are pruned; newer ones are kept', async () => {
    const db = getDb();
    await createUser(db, { role: 'ADMIN' });
    const at = (ms: number) => new Date(SUNDAY.getTime() - ms);
    const blob = (pathname: string, uploadedAt: Date) => ({ pathname, url: `https://blob.example/${pathname}`, uploadedAt });
    const listed = [
      blob('backups/2026-08-09.zip', at(BACKUP_RETENTION_MS + DAY)),
      blob('backups/2026-08-16.zip', at(BACKUP_RETENTION_MS + MIN)),
      blob('backups/2026-08-23.zip', at(BACKUP_RETENTION_MS - MIN)),
      blob('backups/2026-11-01.zip', at(7 * DAY)),
    ];
    const prefixes: string[] = [];
    const deleted: string[][] = [];
    setBackupStoreForTests({
      write: async () => undefined,
      list: async (opts) => {
        prefixes.push(opts.prefix);
        return listed;
      },
      del: async (urls) => {
        deleted.push(urls);
      },
    });
    const out = await runDailyMaintenance(db, SUNDAY);
    expect(BACKUP_RETENTION_MS).toBe(12 * 7 * DAY);
    expect(prefixes).toEqual(['backups/']);
    expect(deleted).toEqual([['https://blob.example/backups/2026-08-09.zip', 'https://blob.example/backups/2026-08-16.zip']]);
    expect(out.backup).toEqual({ status: 'uploaded', path: 'backups/2026-11-08.zip', pruned: 2 });
  });

  it('no pruning when the upload fails; a failing prune does not fail the backup', async () => {
    const db = getDb();
    await createUser(db, { role: 'ADMIN' });
    let listed = 0;
    setBackupStoreForTests({
      write: async () => {
        throw new Error('boom');
      },
      list: async () => {
        listed++;
        return [];
      },
    });
    expect((await runDailyMaintenance(db, SUNDAY)).backup).toEqual({ status: 'failed' });
    expect(listed).toBe(0);

    setBackupStoreForTests({
      write: async () => undefined,
      list: async () => {
        throw new Error('list failed');
      },
    });
    expect((await runDailyMaintenance(db, SUNDAY)).backup).toEqual({ status: 'uploaded', path: 'backups/2026-11-08.zip', pruned: 0 });
  });
});
