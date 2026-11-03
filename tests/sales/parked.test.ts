import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DELETE } from '@/app/api/v1/sales/parked/[id]/route';
import { GET as LIST, POST as PARK } from '@/app/api/v1/sales/parked/route';
import { getDb } from '@/db/client';
import { parkedSales } from '@/db/schema';
import { call } from '../helpers/http';
import { stockFixture } from '../helpers/stock';
import { createUser, sessionCookieFor } from '../helpers/users';

async function fixture() {
  const db = getDb();
  const manager = await createUser(db, { role: 'MANAGER', name: 'Mona' });
  const seller = await createUser(db, { role: 'SELLER', name: 'Sam' });
  const fx = await stockFixture(db, manager.id);
  const v = fx.variants[0];
  const cart = {
    lines: [
      {
        variantId: v.id,
        productId: fx.product.id,
        productName: 'Chino Slim',
        size: v.size,
        color: { name: 'Black', hex: '#000000' },
        sku: v.sku,
        tint: '#000000',
        unitPrice: 1000,
        qty: 1,
        available: 10,
      },
    ],
    discount: { type: 'AMOUNT', value: 0 },
    paymentMethod: 'CASH',
  };
  return { db, manager, seller, cart, cookie: await sessionCookieFor(db, manager.id), sellerCookie: await sessionCookieFor(db, seller.id) };
}

async function park(cookie: string | undefined, body: unknown) {
  const res = await call(PARK, { method: 'POST', path: '/api/v1/sales/parked', body, cookie });
  return { status: res.status, body: await res.json() };
}
async function list(cookie: string) {
  const res = await call(LIST, { path: '/api/v1/sales/parked', cookie });
  return { status: res.status, body: await res.json() };
}
async function unpark(cookie: string, id: string) {
  const res = await call(DELETE, { method: 'DELETE', path: `/api/v1/sales/parked/${id}`, params: { id }, cookie });
  return { status: res.status, body: await res.json() };
}

describe('parked sales', () => {
  it('parks a cart (201) and caps at 3 (409)', async () => {
    const { cookie, cart } = await fixture();
    const r = await park(cookie, { label: 'Ahmed', cart });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ label: 'Ahmed', cart: { lines: [{ variantId: cart.lines[0]!.variantId, qty: 1 }] } });
    expect(typeof r.body.id).toBe('string');
    expect(Number.isNaN(Date.parse(r.body.parkedAt))).toBe(false);
    expect((await park(cookie, { label: 'B', cart })).status).toBe(201);
    expect((await park(cookie, { label: 'C', cart })).status).toBe(201);
    expect((await park(cookie, { label: 'D', cart })).status).toBe(409);
  });

  it('lists own only, oldest first', async () => {
    const { cookie, sellerCookie, cart } = await fixture();
    const a = await park(cookie, { label: 'first', cart });
    const b = await park(cookie, { label: 'second', cart });
    expect((await park(sellerCookie, { label: 'theirs', cart })).status).toBe(201);
    const l = await list(cookie);
    expect(l.status).toBe(200);
    expect(l.body.map((p: { id: string }) => p.id)).toEqual([a.body.id, b.body.id]);
  });

  it('unpark returns the cart; second delete 404; other user 404', async () => {
    const { cookie, sellerCookie, cart } = await fixture();
    const a = await park(cookie, { label: 'Ahmed', cart });
    expect((await unpark(sellerCookie, a.body.id)).status).toBe(404);
    const d = await unpark(cookie, a.body.id);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ id: a.body.id, label: 'Ahmed', cart });
    expect((await unpark(cookie, a.body.id)).status).toBe(404);
  });

  it('expired rows are hidden, not unparkable, and purged', async () => {
    const { db, cookie, cart } = await fixture();
    const a = await park(cookie, { label: 'old', cart });
    await db.update(parkedSales).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(parkedSales.id, a.body.id));
    expect((await unpark(cookie, a.body.id)).status).toBe(404);
    expect((await list(cookie)).body).toEqual([]);
    expect(await db.select().from(parkedSales)).toHaveLength(0);
  });

  it('validation, auth, seller', async () => {
    const { sellerCookie, cart } = await fixture();
    expect((await park(sellerCookie, { label: 'x', cart: { ...cart, extra: 1 } })).status).toBe(400);
    expect((await park(undefined, { label: 'x', cart })).status).toBe(401);
    expect((await park(sellerCookie, { label: 'x', cart })).status).toBe(201);
  });
});
