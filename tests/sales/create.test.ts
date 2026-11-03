import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/sales/route';
import { getDb } from '@/db/client';
import { auditLog, products, sales, settings, stockMovements, variants } from '@/db/schema';
import { expectNoSellerKeys } from '../helpers/catalog';
import { call } from '../helpers/http';
import { stockFixture } from '../helpers/stock';
import { createUser, sessionCookieFor } from '../helpers/users';

async function setup() {
  const db = getDb();
  await db.insert(settings).values({}).onConflictDoNothing();
  const seller = await createUser(db, { role: 'SELLER', name: 'Sam' });
  const manager = await createUser(db, { role: 'MANAGER', name: 'Mona' });
  const fx = await stockFixture(db, manager.id);
  const [a, b, c] = fx.variants;
  return { db, seller, manager, a, b, c, product: fx.product, sellerCookie: await sessionCookieFor(db, seller.id), managerCookie: await sessionCookieFor(db, manager.id) };
}

function post(cookie: string, body: unknown, headers?: Record<string, string>) {
  return call(POST, { method: 'POST', path: '/api/v1/sales', cookie, body, headers });
}

async function qty(id: string) {
  const [r] = await getDb().select({ q: variants.quantity }).from(variants).where(eq(variants.id, id));
  return r?.q;
}

describe('POST /sales', () => {
  it('creates a sale with server totals, snapshots, SALE movements and an audit row (seller view stripped)', async () => {
    const { db, a, b, sellerCookie } = await setup();
    const res = await post(sellerCookie, { items: [{ variantId: a.id, qty: 2 }, { variantId: b.id, qty: 1 }], paymentMethod: 'CASH', customerName: 'Nour' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ number: 'AS-000001', subtotal: 3000, discount: 0, total: 3000, status: 'COMPLETED', paymentMethod: 'CASH', sellerName: 'Sam', customerName: 'Nour', returns: [] });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ variantId: a.id, productName: 'Chino Slim', sku: 'NO-CHI-S-BLACK', qty: 2, unitPrice: 1000, lineTotal: 2000, returnedQty: 0 });
    expect(body.items[0].tint).toBe('#000000');
    expectNoSellerKeys(body);
    expect(await qty(a.id)).toBe(8);
    expect(await qty(b.id)).toBe(4);
    const moves = await db.select().from(stockMovements).where(eq(stockMovements.type, 'SALE'));
    expect(moves).toHaveLength(2);
    expect(moves.every((m) => m.referenceKind === 'sale' && m.referenceId === body.id)).toBe(true);
    const [row] = await db.select().from(sales);
    expect(row?.number).toBe('AS-000001');
    expect((await db.select().from(auditLog)).some((x) => x.action === 'sale.create' && x.entityId === body.id)).toBe(true);
  });

  it('shows cost and profit to managers', async () => {
    const { a, managerCookie } = await setup();
    const res = await post(managerCookie, { items: [{ variantId: a.id, qty: 1 }], paymentMethod: 'CARD' });
    const body = await res.json();
    expect(body).toMatchObject({ cost: 500, profit: 500 });
    expect(body.items[0].unitCost).toBe(500);
  });

  it('enforces the seller discount cap (10 %) but not for managers', async () => {
    const { a, sellerCookie, managerCookie } = await setup();
    const ok = await post(sellerCookie, { items: [{ variantId: a.id, qty: 1 }], discount: { type: 'PCT', value: 10 }, paymentMethod: 'CASH' });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ discount: 100, discountPct: 10, total: 900 });
    const over = await post(sellerCookie, { items: [{ variantId: a.id, qty: 1 }], discount: { type: 'PCT', value: 11 }, paymentMethod: 'CASH' });
    expect(over.status).toBe(400);
    expect((await over.json()).error.fields.discount).toBeTypeOf('string');
    const amountOver = await post(sellerCookie, { items: [{ variantId: a.id, qty: 1 }], discount: { type: 'AMOUNT', value: 101 }, paymentMethod: 'CASH' });
    expect(amountOver.status).toBe(400);
    const mgr = await post(managerCookie, { items: [{ variantId: a.id, qty: 1 }], discount: { type: 'PCT', value: 50 }, paymentMethod: 'CASH' });
    expect(mgr.status).toBe(201);
    expect(await mgr.json()).toMatchObject({ discount: 500, total: 500 });
  });

  it('allows unit price override only with sales.price.override', async () => {
    const { a, sellerCookie, managerCookie } = await setup();
    const seller = await post(sellerCookie, { items: [{ variantId: a.id, qty: 1, unitPrice: 900 }], paymentMethod: 'CASH' });
    expect(seller.status).toBe(403);
    const mgr = await post(managerCookie, { items: [{ variantId: a.id, qty: 1, unitPrice: 900 }], paymentMethod: 'CASH' });
    expect(mgr.status).toBe(201);
    expect(await mgr.json()).toMatchObject({ subtotal: 900, total: 900 });
  });

  it('refuses insufficient stock once per variant, aggregating repeated lines, and writes nothing', async () => {
    const { db, a, c, sellerCookie } = await setup();
    const res = await post(sellerCookie, { items: [{ variantId: a.id, qty: 6 }, { variantId: a.id, qty: 6 }], paymentMethod: 'CASH' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(body.error.fields).toEqual({ [a.id]: 'Only 10 available' });
    expect(await db.select().from(sales)).toHaveLength(0);
    expect(await db.select().from(stockMovements).where(eq(stockMovements.type, 'SALE'))).toHaveLength(0);
    const out = await post(sellerCookie, { items: [{ variantId: c.id, qty: 1 }], paymentMethod: 'CASH' });
    expect(out.status).toBe(409);
    expect((await out.json()).error.fields[c.id]).toBe('Only 0 available');
  });

  it('refuses archived products, unknown variants and empty carts', async () => {
    const { db, a, product, sellerCookie } = await setup();
    await db.update(products).set({ status: 'ARCHIVED' }).where(eq(products.id, product.id));
    expect((await post(sellerCookie, { items: [{ variantId: a.id, qty: 1 }], paymentMethod: 'CASH' })).status).toBe(409);
    expect((await post(sellerCookie, { items: [{ variantId: '00000000-0000-4000-8000-000000000000', qty: 1 }], paymentMethod: 'CASH' })).status).toBe(404);
    expect((await post(sellerCookie, { items: [], paymentMethod: 'CASH' })).status).toBe(400);
    expect((await post(sellerCookie, { items: [{ variantId: a.id, qty: 1 }], paymentMethod: 'CASH', total: 1 })).status).toBe(400);
  });

  it('is idempotent per Idempotency-Key, including under concurrency', async () => {
    const { db, a, sellerCookie } = await setup();
    const key = '11111111-2222-4333-8444-555555555555';
    const body = { items: [{ variantId: a.id, qty: 1 }], paymentMethod: 'CASH' };
    const first = await post(sellerCookie, body, { 'idempotency-key': key });
    expect(first.status).toBe(201);
    const second = await post(sellerCookie, body, { 'idempotency-key': key });
    expect(second.status).toBe(201);
    expect(second.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await second.json()).toEqual(await first.json());
    expect(await db.select().from(sales)).toHaveLength(1);

    const raceKey = '22222222-2222-4333-8444-555555555555';
    const results = await Promise.all([1, 2, 3].map(() => post(sellerCookie, body, { 'idempotency-key': raceKey })));
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(await db.select().from(sales)).toHaveLength(2);
    expect(await qty(a.id)).toBe(8);
  });

  it('requires a session and the sales.create permission', async () => {
    const { a } = await setup();
    expect((await call(POST, { method: 'POST', path: '/api/v1/sales', body: { items: [{ variantId: a.id, qty: 1 }], paymentMethod: 'CASH' } })).status).toBe(401);
  });
});
