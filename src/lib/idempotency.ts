import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { idempotencyKeys } from '@/db/schema';
import { AppError } from './errors';

export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
const IN_PROGRESS = 0;

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Replay protection for POST routes, scoped per user and route.
 * Claim-first: the key row is inserted (status 0) BEFORE `fn` runs, so concurrent requests
 * with the same key cannot all execute — the losers see the claim and get 409 (in progress)
 * or the stored response once the winner finished. If `fn` throws, the claim is released.
 */
export async function withIdempotency<T>(
  db: Db,
  userId: string,
  route: string,
  key: string | null,
  requestHash: string,
  fn: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  if (!key) {
    const r = await fn();
    return { ...r, replayed: false };
  }

  const scope = and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.route, route), eq(idempotencyKeys.key, key));
  const since = new Date(Date.now() - IDEMPOTENCY_TTL_MS);

  // Expired rows are dead weight: clear one if present so the claim below can succeed.
  await db.delete(idempotencyKeys).where(and(scope, lt(idempotencyKeys.createdAt, since)));

  const claimed = await db
    .insert(idempotencyKeys)
    .values({ userId, route, key, requestHash, status: IN_PROGRESS, response: {} })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });

  if (claimed.length === 0) {
    const [existing] = await db.select().from(idempotencyKeys).where(scope).limit(1);
    if (!existing) throw new AppError('CONFLICT', 'Idempotency-Key is being processed, retry shortly');
    if (existing.requestHash !== requestHash) {
      throw new AppError('CONFLICT', 'Idempotency-Key reused with a different request');
    }
    if (existing.status === IN_PROGRESS) {
      throw new AppError('CONFLICT', 'Idempotency-Key is being processed, retry shortly', { retryAfter: 2 });
    }
    return { status: existing.status, body: existing.response as T, replayed: true };
  }

  let r: { status: number; body: T };
  try {
    r = await fn();
  } catch (err) {
    await db.delete(idempotencyKeys).where(scope);
    throw err;
  }
  await db
    .update(idempotencyKeys)
    .set({ status: r.status, response: r.body as object })
    .where(scope);
  return { ...r, replayed: false };
}
