import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { failedLogins } from '@/db/schema';

export const LOCKOUT_THRESHOLD = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60_000;

/** Seconds until the email may try again, or 0 when not locked. */
export async function getLockRemaining(db: Db, email: string): Promise<number> {
  const [row] = await db.select({ lockedUntil: failedLogins.lockedUntil }).from(failedLogins).where(eq(failedLogins.email, email));
  if (!row?.lockedUntil) return 0;
  const remaining = row.lockedUntil.getTime() - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** Count a failed attempt within the window; lock when the threshold is reached. */
export async function recordFailure(db: Db, email: string, ip: string | null): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - LOCKOUT_WINDOW_MS).toISOString();
  const lockedUntil = new Date(now.getTime() + LOCKOUT_WINDOW_MS).toISOString();
  // Reset the counter when the last failure is older than the window; lock at the threshold.
  // Bound values inside CASE need explicit casts or Postgres infers text.
  const nextCount = sql`CASE WHEN ${failedLogins.updatedAt} < ${windowStart}::timestamptz THEN 1 ELSE ${failedLogins.count} + 1 END`;
  await db
    .insert(failedLogins)
    .values({ email, ip, count: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: failedLogins.email,
      set: {
        count: nextCount,
        lockedUntil: sql`CASE WHEN (${nextCount}) >= ${LOCKOUT_THRESHOLD}::int THEN ${lockedUntil}::timestamptz ELSE NULL END`,
        ip,
        updatedAt: now,
      },
    });
}

export async function clearFailures(db: Db, email: string): Promise<void> {
  await db.delete(failedLogins).where(eq(failedLogins.email, email));
}
