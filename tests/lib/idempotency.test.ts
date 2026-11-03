import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { idempotencyKeys } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { createUser } from '../helpers/users';

describe('withIdempotency', () => {
  it('runs once per key and replays the stored response', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return { status: 201, body: { number: `PO-00000${calls}` } };
    };
    const first = await withIdempotency(db, u.id, 'key-1', 'hash-a', fn);
    expect(first).toEqual({ status: 201, body: { number: 'PO-000001' }, replayed: false });
    const second = await withIdempotency(db, u.id, 'key-1', 'hash-a', fn);
    expect(second).toEqual({ status: 201, body: { number: 'PO-000001' }, replayed: true });
    expect(calls).toBe(1);
  });

  it('rejects the same key with a different request and ignores keys older than 24 h', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    const fn = async () => ({ status: 201, body: { ok: true } });
    await withIdempotency(db, u.id, 'key-2', 'hash-a', fn);
    await expect(withIdempotency(db, u.id, 'key-2', 'hash-b', fn)).rejects.toMatchObject({ code: 'CONFLICT' } satisfies Partial<AppError>);
    await db.update(idempotencyKeys).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(idempotencyKeys.key, 'key-2'));
    const again = await withIdempotency(db, u.id, 'key-2', 'hash-b', fn);
    expect(again.replayed).toBe(false);
  });

  it('runs fn directly when no key is given', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    const r = await withIdempotency(db, u.id, null, 'hash', async () => ({ status: 200, body: 1 }));
    expect(r).toEqual({ status: 200, body: 1, replayed: false });
    expect(await db.select().from(idempotencyKeys)).toHaveLength(0);
  });
});
