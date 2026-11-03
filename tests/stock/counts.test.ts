import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as APPLY } from '@/app/api/v1/stock/counts/[id]/apply/route';
import { POST as CANCEL } from '@/app/api/v1/stock/counts/[id]/cancel/route';
import { GET as GET_ONE, PATCH } from '@/app/api/v1/stock/counts/[id]/route';
import { GET as LIST, POST as START } from '@/app/api/v1/stock/counts/route';
import { getDb } from '@/db/client';
import { stockMovements, variants } from '@/db/schema';
import { applyMovement } from '@/services/stock';
import { expectNoSellerKeys } from '../helpers/catalog';
import { call } from '../helpers/http';
import { stockFixture } from '../helpers/stock';
import { createUser, sessionCookieFor } from '../helpers/users';

async function fixture() {
  const db = getDb();
  const manager = await createUser(db, { role: 'MANAGER', name: 'Mona' });
  const seller = await createUser(db, { role: 'SELLER', name: 'Sam' });
  const fx = await stockFixture(db, manager.id);
  return { db, manager, seller, cookie: await sessionCookieFor(db, manager.id), sellerCookie: await sessionCookieFor(db, seller.id), ...fx };
}

async function start(cookie: string, body: unknown = {}) {
  const res = await call(START, { method: 'POST', path: '/api/v1/stock/counts', body, cookie });
  return { status: res.status, body: await res.json() };
}
async function patch(cookie: string, id: string, body: unknown) {
  const res = await call(PATCH, { method: 'PATCH', path: `/api/v1/stock/counts/${id}`, params: { id }, body, cookie });
  return { status: res.status, body: await res.json() };
}
async function apply(cookie: string, id: string, body: unknown = {}) {
  const res = await call(APPLY, { method: 'POST', path: `/api/v1/stock/counts/${id}/apply`, params: { id }, body, cookie });
  return { status: res.status, body: await res.json() };
}
async function cancel(cookie: string, id: string) {
  const res = await call(CANCEL, { method: 'POST', path: `/api/v1/stock/counts/${id}/cancel`, params: { id }, cookie });
  return { status: res.status, body: await res.json() };
}
async function getOne(cookie: string, id: string) {
  const res = await call(GET_ONE, { path: `/api/v1/stock/counts/${id}`, params: { id }, cookie });
  return { status: res.status, body: await res.json() };
}

describe('stock counts', () => {
  it('MANAGER starts a count: 201, SC-000001, OPEN, items snapshot system qty ordered by size', async () => {
    const { cookie, manager, variants: [a, b, c] } = await fixture();
    const { status, body } = await start(cookie);
    expect(status).toBe(201);
    expect(body).toMatchObject({ number: 'SC-000001', status: 'OPEN', scope: 'all', startedBy: manager.id, startedByName: 'Mona', counters: [] });
    expect(body.items.map((i: { variantId: string; systemQty: number; countedQty: number | null }) => [i.variantId, i.systemQty, i.countedQty])).toEqual([
      [c.id, 0, null],
      [b.id, 5, null],
      [a.id, 10, null],
    ]);
    expect(body.items[2].variant).toMatchObject({ size: 'S', sku: a.sku, color: { name: 'Black', hex: '#000000' }, costPrice: 500, productName: 'Chino Slim' });
    const list = await call(LIST, { path: '/api/v1/stock/counts', cookie });
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody).toHaveLength(1);
    expect(listBody[0]).toMatchObject({ id: body.id, number: 'SC-000001' });
    expect(listBody[0].items).toHaveLength(3);
    expect((await getOne(cookie, body.id)).body.id).toBe(body.id);
  });

  it('productIds limits the snapshot; unknown body keys and bad ids are rejected', async () => {
    const { cookie, product, variants: [a] } = await fixture();
    const { status, body } = await start(cookie, { scope: 'chinos', productIds: [product.id] });
    expect(status).toBe(201);
    expect(body.scope).toBe('chinos');
    expect(body.items.map((i: { variantId: string }) => i.variantId)).toContain(a.id);
    expect((await start(cookie, { foo: 1 })).status).toBe(400);
    expect((await start(cookie, { productIds: ['nope'] })).status).toBe(400);
  });

  it('SELLER can read and record counts but cannot start or apply', async () => {
    const { cookie, sellerCookie, seller, variants: [a] } = await fixture();
    expect((await start(sellerCookie)).status).toBe(403);
    const { body: count } = await start(cookie);
    expect((await getOne(sellerCookie, count.id)).status).toBe(200);
    const patched = await patch(sellerCookie, count.id, { items: [{ variantId: a.id, countedQty: 8 }] });
    expect(patched.status).toBe(200);
    const item = patched.body.items.find((i: { variantId: string }) => i.variantId === a.id);
    expect(item).toMatchObject({ countedQty: 8, countedBy: seller.id });
    expect(typeof item.countedAt).toBe('string');
    expect(patched.body.counters).toEqual(['Sam']);
    expectNoSellerKeys(patched.body);
    expect((await apply(sellerCookie, count.id)).status).toBe(403);
    expect((await cancel(sellerCookie, count.id)).status).toBe(403);
  });

  it('rejects an unknown variant with a per-item field path, an empty list and a negative qty', async () => {
    const { cookie, variants: [a] } = await fixture();
    const { body: count } = await start(cookie);
    const res = await patch(cookie, count.id, { items: [{ variantId: a.id, countedQty: 1 }, { variantId: '00000000-0000-4000-8000-000000000001', countedQty: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual({ 'items.1.variantId': expect.any(String) });
    expect((await patch(cookie, count.id, { items: [] })).status).toBe(400);
    expect((await patch(cookie, count.id, { items: [{ variantId: a.id, countedQty: -1 }] })).status).toBe(400);
  });

  it('applies against live quantity: a change between snapshot and apply does not double-adjust', async () => {
    const { db, cookie, manager, variants: [a, b, c] } = await fixture();
    const { body: count } = await start(cookie);
    await patch(cookie, count.id, { items: [{ variantId: a.id, countedQty: 8 }] });
    // A sells one unit after the snapshot (10 -> 9); the count of 8 must produce -1, not -2.
    await db.transaction((tx) => applyMovement(tx, { variantId: a.id, type: 'SALE', qtyDelta: -1, userId: manager.id }));

    const applied = await apply(cookie, count.id);
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ id: count.id, status: 'APPLIED' });
    expect(typeof applied.body.appliedAt).toBe('string');

    const [liveA] = await db.select().from(variants).where(eq(variants.id, a.id));
    expect(liveA?.quantity).toBe(8);
    const moves = await db.select().from(stockMovements).where(eq(stockMovements.referenceId, count.id));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ variantId: a.id, type: 'ADJUSTMENT', qtyDelta: -1, qtyAfter: 8, referenceKind: 'count', reason: 'Stock count SC-000001', userId: manager.id });
    // B and C were not counted and uncountedAsZero was not set: untouched.
    const [liveB] = await db.select().from(variants).where(eq(variants.id, b.id));
    const [liveC] = await db.select().from(variants).where(eq(variants.id, c.id));
    expect([liveB?.quantity, liveC?.quantity]).toEqual([5, 0]);

    expect((await apply(cookie, count.id)).status).toBe(409);
    expect((await patch(cookie, count.id, { items: [{ variantId: a.id, countedQty: 1 }] })).status).toBe(409);
  });

  it('uncountedAsZero zeroes uncounted variants with stock and skips those already at zero', async () => {
    const { db, cookie, variants: [a, b, c] } = await fixture();
    const { body: count } = await start(cookie);
    await patch(cookie, count.id, { items: [{ variantId: a.id, countedQty: 10 }] });
    const applied = await apply(cookie, count.id, { uncountedAsZero: true });
    expect(applied.status).toBe(200);
    expect(applied.body.status).toBe('APPLIED');
    const moves = await db.select().from(stockMovements).where(eq(stockMovements.referenceId, count.id));
    expect(moves.map((m) => [m.variantId, m.qtyDelta])).toEqual([[b.id, -5]]);
    const [liveB] = await db.select().from(variants).where(eq(variants.id, b.id));
    expect(liveB?.quantity).toBe(0);
    const [liveC] = await db.select().from(variants).where(eq(variants.id, c.id));
    expect(liveC?.quantity).toBe(0);
    expect((await apply(cookie, count.id, { extra: true })).status).toBe(400);
  });

  it('cancel moves OPEN to CANCELLED; apply, patch and cancel afterwards are 409', async () => {
    const { cookie, variants: [a] } = await fixture();
    const { body: count } = await start(cookie);
    const cancelled = await cancel(cookie, count.id);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ id: count.id, status: 'CANCELLED' });
    expect((await apply(cookie, count.id)).status).toBe(409);
    expect((await patch(cookie, count.id, { items: [{ variantId: a.id, countedQty: 1 }] })).status).toBe(409);
    expect((await cancel(cookie, count.id)).status).toBe(409);
    expect((await getOne(cookie, '00000000-0000-4000-8000-000000000001')).status).toBe(404);
  });

  it('SELLER sees no cost fields on any count response', async () => {
    const { cookie, sellerCookie } = await fixture();
    const { body: count } = await start(cookie);
    const one = await getOne(sellerCookie, count.id);
    expect(one.status).toBe(200);
    expectNoSellerKeys(one.body);
    const list = await call(LIST, { path: '/api/v1/stock/counts', cookie: sellerCookie });
    expect(list.status).toBe(200);
    expectNoSellerKeys(await list.json());
  });
});
