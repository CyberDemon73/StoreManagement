import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/sales/[id]/receipt/route';
import { getDb } from '@/db/client';
import { createSale } from '@/services/sales';
import { expectNoSellerKeys } from '../helpers/catalog';
import { call } from '../helpers/http';
import { authUserOf, saleFixture } from '../helpers/sales';
import { createUser, sessionCookieFor } from '../helpers/users';

const CTX = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'test' };

async function setup() {
  const db = getDb();
  const fx = await saleFixture(db);
  const other = await createUser(db, { role: 'SELLER', name: 'Omar' });
  const [, b] = fx.variants;
  // A hostile customer name: the HTML receipt must escape it.
  const otherSale = await createSale(
    db,
    authUserOf(other, 'Omar'),
    { items: [{ variantId: b.id, qty: 1 }], paymentMethod: 'CARD', customerName: '<b>x</b>' },
    CTX,
  );
  return { db, ...fx, other, otherSale, sellerCookie: await sessionCookieFor(db, fx.seller.id), managerCookie: await sessionCookieFor(db, fx.manager.id) };
}

function receipt(cookie: string, id: string, qs = '') {
  return call(GET, { path: `/api/v1/sales/${id}/receipt${qs}`, params: { id }, cookie });
}

describe('GET /sales/:id/receipt', () => {
  it('returns the sale and store block as JSON by default', async () => {
    const { managerCookie, sale } = await setup();
    const res = await receipt(managerCookie, sale.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.sale).toMatchObject({ id: sale.id, number: 'AS-000001', total: 3000, cost: 1500 });
    expect(body.store).toMatchObject({ storeName: 'Avenue Stock', currency: 'EGP' });
    expect(body.store).toHaveProperty('receiptFooter');
  });

  it('strips cost fields from the JSON receipt for a SELLER', async () => {
    const { sellerCookie, sale } = await setup();
    const res = await receipt(sellerCookie, sale.id, '?format=json');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sale.number).toBe('AS-000001');
    expectNoSellerKeys(body);
  });

  it('renders a self-contained HTML receipt with escaped text and no scripts', async () => {
    const { managerCookie, sale, otherSale } = await setup();
    const res = await receipt(managerCookie, sale.id, '?format=html');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('AS-000001');
    expect(html).toContain('Avenue Stock');
    expect(html).toContain('Chino Slim');
    expect(html).toContain('CASH');
    expect(html).not.toContain('<script');

    const hostile = await (await receipt(managerCookie, otherSale.id, '?format=html')).text();
    expect(hostile).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(hostile).not.toContain('<b>x</b>');
    expect(hostile).not.toContain('<script');
  });

  it("returns 404 for another seller's sale and 400 for an unknown format", async () => {
    const { sellerCookie, managerCookie, sale, otherSale } = await setup();
    const res = await receipt(sellerCookie, otherSale.id);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    expect((await receipt(sellerCookie, otherSale.id, '?format=html')).status).toBe(404);
    expect((await receipt(managerCookie, sale.id, '?format=pdf')).status).toBe(400);
    expect((await receipt(managerCookie, sale.id, '?foo=1')).status).toBe(400);
    expect((await call(GET, { path: `/api/v1/sales/${sale.id}/receipt`, params: { id: sale.id } })).status).toBe(401);
  });
});
