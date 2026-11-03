import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { idempotencyKeys } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { createUser } from '../helpers/users';

const ROUTE = 'POST /stock/purchases';

describe('withIdempotency', () => {
  it('runs once per key and replays the stored response', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return { status: 201, body: { number: `PO-00000${calls}` } };
    };
    const first = await withIdempotency(db, u.id, ROUTE, 'key-1', 'hash-a', fn);
    expect(first).toEqual({ status: 201, body: { number: 'PO-000001' }, replayed: false });
    const second = await withIdempotency(db, u.id, ROUTE, 'key-1', 'hash-a', fn);
    expect(second).toEqual({ status: 201, body: { number: 'PO-000001' }, replayed: true });
    expect(calls).toBe(1);
  });

  it('rejects the same key with a different request and ignores keys older than 24 h', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    const fn = async () => ({ status: 201, body: { ok: true } });
    await withIdempotency(db, u.id, ROUTE, 'key-2', 'hash-a', fn);
    await expect(withIdempotency(db, u.id, ROUTE, 'key-2', 'hash-b', fn)).rejects.toMatchObject({ code: 'CONFLICT' } satisfies Partial<AppError>);
    await db.update(idempotencyKeys).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(idempotencyKeys.key, 'key-2'));
    const again = await withIdempotency(db, u.id, ROUTE, 'key-2', 'hash-b', fn);
    expect(again.replayed).toBe(false);
  });

  it('runs fn directly when no key is given', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    const r = await withIdempotency(db, u.id, ROUTE, null, 'hash', async () => ({ status: 200, body: 1 }));
    expect(r).toEqual({ status: 200, body: 1, replayed: false });
    expect(await db.select().from(idempotencyKeys)).toHaveLength(0);
  });

  it('claims the key before running fn so concurrent duplicates run fn exactly once', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    let calls = 0;
    const fn = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 50));
      return { status: 201, body: { n: calls } };
    };
    const results = await Promise.allSettled([1, 2, 3].map(() => withIdempotency(db, u.id, ROUTE, 'key-race', 'hash-a', fn)));
    expect(calls).toBe(1);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) expect((r.reason as AppError).code).toBe('CONFLICT');
    // After the first completes, a later identical call replays.
    const later = await withIdempotency(db, u.id, ROUTE, 'key-race', 'hash-a', fn);
    expect(later).toEqual({ status: 201, body: { n: 1 }, replayed: true });
    expect(calls).toBe(1);
  });

  it('releases the claim when fn throws so a retry can succeed', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    await expect(
      withIdempotency(db, u.id, ROUTE, 'key-fail', 'hash-a', async () => {
        throw new AppError('CONFLICT', 'boom');
      }),
    ).rejects.toMatchObject({ message: 'boom' });
    const ok = await withIdempotency(db, u.id, ROUTE, 'key-fail', 'hash-a', async () => ({ status: 201, body: { ok: true } }));
    expect(ok.replayed).toBe(false);
  });

  it('scopes keys per route', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    await withIdempotency(db, u.id, ROUTE, 'key-3', 'hash-a', async () => ({ status: 201, body: 'purchase' }));
    const other = await withIdempotency(db, u.id, 'POST /sales', 'key-3', 'hash-z', async () => ({ status: 201, body: 'sale' }));
    expect(other).toEqual({ status: 201, body: 'sale', replayed: false });
  });
});
