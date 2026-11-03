import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/stock/movements/route';
import { getDb } from '@/db/client';
import { applyMovement } from '@/services/stock';
import { call } from '../helpers/http';
import { stockFixture } from '../helpers/stock';
import { createUser, sessionCookieFor } from '../helpers/users';

async function fixture() {
  const db = getDb();
  const manager = await createUser(db, { role: 'MANAGER', name: 'Mona' });
  const fx = await stockFixture(db, manager.id);
  const [a] = fx.variants;
  // One movement without a user (userName must fall back to '—').
  await db.transaction((tx) => applyMovement(tx, { variantId: a.id, type: 'SALE', qtyDelta: -2, userId: null }));
  return { db, manager, cookie: await sessionCookieFor(db, manager.id), ...fx };
}

async function list(cookie: string, qs = '') {
  const res = await call(GET, { path: `/api/v1/stock/movements${qs}`, cookie });
  return { status: res.status, body: await res.json() };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

describe('GET /stock/movements', () => {
  it('lists movements newest first with variant, user and qtyAfter for a MANAGER', async () => {
    const { cookie, manager, variants, product } = await fixture();
    const [a, b] = variants;
    const { status, body } = await list(cookie);
    expect(status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 25, total: 3 });
    expect(body.data).toHaveLength(3);
    // The two INITIAL rows share one transaction timestamp (now()), so only the SALE's position is fixed.
    const [sale] = body.data;
    const initA = body.data.find((m: { variantId: string; type: string }) => m.variantId === a.id && m.type === 'INITIAL');
    const initB = body.data.find((m: { variantId: string }) => m.variantId === b.id);
    expect(sale).toMatchObject({
      variantId: a.id,
      type: 'SALE',
      qtyDelta: -2,
      qtyAfter: 8,
      userId: null,
      userName: '—',
      variant: { size: 'S', sku: a.sku, color: { name: 'Black', hex: '#000000' }, productName: product.name },
    });
    expect(sale.unitCost).toBeUndefined();
    expect(sale.reference).toBeUndefined();
    expect(sale.reason).toBeUndefined();
    expect(initB).toMatchObject({ variantId: b.id, type: 'INITIAL', qtyDelta: 5, qtyAfter: 5, unitCost: 500, reason: 'fixture', userId: manager.id, userName: 'Mona' });
    expect(initA).toMatchObject({ variantId: a.id, type: 'INITIAL', qtyDelta: 10, qtyAfter: 10, unitCost: 500 });
    expect(initA.createdAt).toBeTypeOf('string');
  });

  it('filters by variantId, productId, type, userId and q (sku / product name)', async () => {
    const { cookie, manager, variants, product } = await fixture();
    const [a, b] = variants;
    expect((await list(cookie, `?variantId=${b.id}`)).body.data.map((m: { id: string; variantId: string }) => m.variantId)).toEqual([b.id]);
    expect((await list(cookie, `?productId=${product.id}`)).body.total).toBe(3);
    expect((await list(cookie, '?type=INITIAL')).body.data.map((m: { type: string }) => m.type)).toEqual(['INITIAL', 'INITIAL']);
    expect((await list(cookie, `?userId=${manager.id}`)).body.total).toBe(2);
    expect((await list(cookie, `?q=${a.sku}`)).body.total).toBe(2);
    expect((await list(cookie, '?q=chino%20slim')).body.total).toBe(3);
    expect((await list(cookie, '?q=%25')).body.total).toBe(0);
  });

  it('treats from/to as UTC day boundaries with `to` inclusive', async () => {
    const { cookie } = await fixture();
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    expect((await list(cookie, `?to=${isoDay(today)}`)).body.total).toBe(3);
    expect((await list(cookie, `?from=${isoDay(today)}&to=${isoDay(today)}`)).body.total).toBe(3);
    expect((await list(cookie, `?to=${isoDay(yesterday)}`)).body.total).toBe(0);
    expect((await list(cookie, `?from=${isoDay(tomorrow)}`)).body.total).toBe(0);
    expect((await list(cookie, '?from=2026-1-1')).status).toBe(400);
  });

  it('paginates and counts past the last page', async () => {
    const { cookie } = await fixture();
    const p1 = await list(cookie, '?pageSize=2');
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.total).toBe(3);
    const p3 = await list(cookie, '?pageSize=2&page=3');
    expect(p3.body.data).toEqual([]);
    expect(p3.body.total).toBe(3);
  });

  it('returns 403 for a SELLER, 401 anonymously and 400 for pageSize 500 / unknown keys', async () => {
    const { db, cookie } = await fixture();
    const s = await createUser(db, { role: 'SELLER' });
    const forbidden = await list(await sessionCookieFor(db, s.id));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect((await call(GET, { path: '/api/v1/stock/movements' })).status).toBe(401);
    expect((await list(cookie, '?pageSize=500')).status).toBe(400);
    expect((await list(cookie, '?foo=1')).status).toBe(400);
  });
});
