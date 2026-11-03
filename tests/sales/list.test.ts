import { describe, expect, it } from 'vitest';
import { GET as GET_ONE } from '@/app/api/v1/sales/[id]/route';
import { GET } from '@/app/api/v1/sales/route';
import { getDb } from '@/db/client';
import { createSale } from '@/services/sales';
import { expectNoSellerKeys } from '../helpers/catalog';
import { call } from '../helpers/http';
import { authUserOf, saleFixture } from '../helpers/sales';
import { createUser, sessionCookieFor } from '../helpers/users';

const CTX = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'test' };

/** saleFixture plus a second seller (Omar) with a CARD sale of B×1 for customer Nour. */
async function setup() {
  const db = getDb();
  const fx = await saleFixture(db);
  const other = await createUser(db, { role: 'SELLER', name: 'Omar' });
  const [, b] = fx.variants;
  const otherSale = await createSale(
    db,
    authUserOf(other, 'Omar'),
    { items: [{ variantId: b.id, qty: 1 }], paymentMethod: 'CARD', customerName: 'Nour Adel', customerPhone: '01000000000' },
    CTX,
  );
  return {
    db,
    ...fx,
    other,
    otherSale,
    sellerCookie: await sessionCookieFor(db, fx.seller.id),
    managerCookie: await sessionCookieFor(db, fx.manager.id),
  };
}

async function list(cookie: string, qs = '') {
  const res = await call(GET, { path: `/api/v1/sales${qs}`, cookie });
  return { status: res.status, body: await res.json() };
}

async function getOne(cookie: string, id: string) {
  const res = await call(GET_ONE, { path: `/api/v1/sales/${id}`, params: { id }, cookie });
  return { status: res.status, body: await res.json() };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const numbers = (body: { data: { number: string }[] }) => body.data.map((s) => s.number);

describe('GET /sales', () => {
  it('lists every sale newest first for a MANAGER', async () => {
    const { managerCookie } = await setup();
    const { status, body } = await list(managerCookie);
    expect(status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 25, total: 2 });
    expect(numbers(body)).toEqual(['AS-000002', 'AS-000001']);
    expect(body.data[1]).toMatchObject({ sellerName: 'Sam', cost: 1500, returns: [] });
    expect(body.data[1].items.map((i: { qty: number }) => i.qty).sort()).toEqual([1, 2]);
  });

  it('shows a SELLER only their own sales, stripped of cost fields', async () => {
    const { sellerCookie, seller } = await setup();
    const { status, body } = await list(sellerCookie);
    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(numbers(body)).toEqual(['AS-000001']);
    expect(body.data[0].sellerId).toBe(seller.id);
    expectNoSellerKeys(body);
  });

  it('refuses a SELLER asking for another seller (403) but accepts their own id', async () => {
    const { sellerCookie, seller, other } = await setup();
    const forbidden = await list(sellerCookie, `?sellerId=${other.id}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect((await list(sellerCookie, `?sellerId=${seller.id}`)).body.total).toBe(1);
  });

  it('filters by sellerId, paymentMethod, status, q (number / customer name) and productId', async () => {
    const { managerCookie, other, product } = await setup();
    expect(numbers((await list(managerCookie, `?sellerId=${other.id}`)).body)).toEqual(['AS-000002']);
    expect(numbers((await list(managerCookie, '?paymentMethod=CARD')).body)).toEqual(['AS-000002']);
    expect((await list(managerCookie, '?status=COMPLETED')).body.total).toBe(2);
    expect((await list(managerCookie, '?status=VOID')).body.total).toBe(0);
    expect(numbers((await list(managerCookie, '?q=AS-000001')).body)).toEqual(['AS-000001']);
    expect(numbers((await list(managerCookie, '?q=nour')).body)).toEqual(['AS-000002']);
    expect(numbers((await list(managerCookie, '?q=0100')).body)).toEqual(['AS-000002']);
    expect((await list(managerCookie, '?q=%25')).body.total).toBe(0);
    expect((await list(managerCookie, `?productId=${product.id}`)).body.total).toBe(2);
    expect((await list(managerCookie, '?productId=00000000-0000-4000-8000-000000000001')).body.total).toBe(0);
  });

  it('treats from/to as UTC day boundaries with `to` inclusive and rejects non-calendar dates', async () => {
    const { managerCookie } = await setup();
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    expect((await list(managerCookie, `?from=${isoDay(today)}&to=${isoDay(today)}`)).body.total).toBe(2);
    expect((await list(managerCookie, `?to=${isoDay(yesterday)}`)).body.total).toBe(0);
    expect((await list(managerCookie, `?from=${isoDay(tomorrow)}`)).body.total).toBe(0);
    expect((await list(managerCookie, '?from=2026-02-30')).status).toBe(400);
  });

  it('paginates, counts past the last page and rejects pageSize 500 / unknown keys', async () => {
    const { managerCookie } = await setup();
    const p1 = await list(managerCookie, '?pageSize=1');
    expect(p1.body.data).toHaveLength(1);
    expect(p1.body.total).toBe(2);
    const p3 = await list(managerCookie, '?pageSize=1&page=3');
    expect(p3.body.data).toEqual([]);
    expect(p3.body.total).toBe(2);
    expect((await list(managerCookie, '?pageSize=500')).status).toBe(400);
    expect((await list(managerCookie, '?foo=1')).status).toBe(400);
    expect((await call(GET, { path: '/api/v1/sales' })).status).toBe(401);
  });
});

describe('GET /sales/:id', () => {
  it('returns 200 with cost for a MANAGER', async () => {
    const { managerCookie, sale } = await setup();
    const { status, body } = await getOne(managerCookie, sale.id);
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: sale.id, number: 'AS-000001', cost: 1500, profit: 1500 });
  });

  it('returns the seller their own sale without cost fields', async () => {
    const { sellerCookie, sale } = await setup();
    const { status, body } = await getOne(sellerCookie, sale.id);
    expect(status).toBe(200);
    expect(body.number).toBe('AS-000001');
    expectNoSellerKeys(body);
  });

  it("returns 404 for another seller's sale (no existence leak) and for an unknown id", async () => {
    const { sellerCookie, managerCookie, otherSale } = await setup();
    const res = await getOne(sellerCookie, otherSale.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await getOne(managerCookie, otherSale.id)).status).toBe(200);
    expect((await getOne(managerCookie, '00000000-0000-4000-8000-000000000001')).status).toBe(404);
    expect((await getOne(managerCookie, 'abc')).status).toBe(400);
  });
});
