import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/analytics/price-list/route';
import { getDb } from '@/db/client';
import { products } from '@/db/schema';
import { priceList } from '@/analytics/price-list';
import { analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

describe('price list', () => {
  it('lists active variants with cost, price and margin, ordered by product, size, sku', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const res = await priceList(db, { page: 1, pageSize: 25 });
    expect(res.total).toBe(3);
    expect(res.data.map((r) => r.sku)).toEqual(['CA-TEE-S-WHITE', 'NO-SHI-M-BLACK', 'NO-SHI-S-BLACK']);
    expect(res.data.find((r) => r.variantId === fx.n1.id)).toEqual({
      variantId: fx.n1.id,
      productName: 'North Shirt',
      brand: 'Northline',
      sku: 'NO-SHI-S-BLACK',
      size: 'S',
      color: { name: 'Black', hex: '#111111' },
      costPrice: 400,
      sellPrice: 1000,
      marginPct: 60,
      quantity: 18,
    });
  });

  it('paginates, searches with escaped LIKE and hides ARCHIVED products', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const page2 = await priceList(db, { page: 2, pageSize: 2 });
    expect(page2).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page2.data.map((r) => r.sku)).toEqual(['NO-SHI-S-BLACK']);
    expect((await priceList(db, { page: 1, pageSize: 25, q: 'casa tee' })).data.map((r) => r.sku)).toEqual(['CA-TEE-S-WHITE']);
    expect((await priceList(db, { page: 1, pageSize: 25, q: 'no-shi-m' })).total).toBe(1);
    expect((await priceList(db, { page: 1, pageSize: 25, q: '%' })).total).toBe(0);
    await db.update(products).set({ status: 'ARCHIVED' }).where(eq(products.id, fx.productPC.id));
    expect((await priceList(db, { page: 1, pageSize: 25 })).total).toBe(2);
  });

  it('GET: manager 200 with private cache, SELLER 403, oversize q 400', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const manager = await sessionCookieFor(db, fx.manager.id);
    const ok = await call(GET, { path: '/api/v1/analytics/price-list?page=1&pageSize=2', cookie: manager });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await ok.json()).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    const seller = await sessionCookieFor(db, fx.sellerA.id);
    expect((await call(GET, { path: '/api/v1/analytics/price-list', cookie: seller })).status).toBe(403);
    expect((await call(GET, { path: `/api/v1/analytics/price-list?q=${'a'.repeat(101)}`, cookie: manager })).status).toBe(400);
  });
});
