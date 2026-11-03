import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { idempotencyKeys } from '@/db/schema';
import { AppError } from './errors';

export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Replay protection for POST routes: the first call with a key runs `fn` and stores its
 * response for 24 h; later calls with the same key and request hash get the stored response.
 * The same key with a different request is a client bug and is refused.
 */
export async function withIdempotency<T>(
  db: Db,
  userId: string,
  key: string | null,
  requestHash: string,
  fn: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  if (!key) {
    const r = await fn();
    return { ...r, replayed: false };
  }

  const since = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
  const [hit] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key), gt(idempotencyKeys.createdAt, since)))
    .limit(1);
  if (hit) {
    if (hit.requestHash !== requestHash) {
      throw new AppError('CONFLICT', 'Idempotency-Key reused with a different request');
    }
    return { status: hit.status, body: hit.response as T, replayed: true };
  }

  const r = await fn();
  await db
    .insert(idempotencyKeys)
    .values({ userId, key, requestHash, status: r.status, response: r.body as object })
    .onConflictDoUpdate({
      target: [idempotencyKeys.userId, idempotencyKeys.key],
      set: { requestHash, status: r.status, response: r.body as object, createdAt: new Date() },
    });
  return { ...r, replayed: false };
}
