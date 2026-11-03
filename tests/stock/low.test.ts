import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/stock/low/route';
import { getDb } from '@/db/client';
import { applyMovement } from '@/services/stock';
import { createProductDirect, createVariantDirect, expectNoSellerKeys } from '../helpers/catalog';
import { call } from '../helpers/http';
import { stockFixture } from '../helpers/stock';
import { createUser, sessionCookieFor } from '../helpers/users';

async function fixture() {
  const db = getDb();
  const manager = await createUser(db, { role: 'MANAGER' });
  const fx = await stockFixture(db, manager.id);
  // Shared fixture has B at 5 (threshold 3); sell 3 so B sits at 2, inside the threshold.
  await db.transaction((tx) => applyMovement(tx, { variantId: fx.variants[1].id, type: 'SALE', qtyDelta: -3, userId: manager.id }));
  const seller = await createUser(db, { role: 'SELLER' });
  return { db, cookie: await sessionCookieFor(db, manager.id), sellerCookie: await sessionCookieFor(db, seller.id), ...fx };
}

async function low(cookie: string) {
  const res = await call(GET, { path: '/api/v1/stock/low', cookie });
  return { status: res.status, body: await res.json() };
}

describe('GET /stock/low', () => {
  it('splits active variants of ACTIVE products into low (0 < qty <= threshold) and out (qty <= 0)', async () => {
    const { cookie, variants, product } = await fixture();
    const [, b, c] = variants;
    const { status, body } = await low(cookie);
    expect(status).toBe(200);
    expect(body.low.map((v: { id: string }) => v.id)).toEqual([b.id]);
    expect(body.out.map((v: { id: string }) => v.id)).toEqual([c.id]);
    expect(body.low[0]).toMatchObject({ sku: b.sku, quantity: 2, lowStockThreshold: 3, costPrice: 500, product: { id: product.id, name: 'Chino Slim', brandName: 'Northline' } });
  });

  it('excludes archived products and inactive variants, ordered by product name then size', async () => {
    const { db, cookie, brand, category, variants } = await fixture();
    const [, b, c] = variants;
    const old = await createProductDirect(db, { brandId: brand.id, categoryId: category.id, name: 'Aged', baseSku: 'NO-OLD', defaultPrice: 900, status: 'ARCHIVED' });
    await createVariantDirect(db, { productId: old.id, size: 'S', colorName: 'Black', sku: 'NO-OLD-S-BLACK', sellPrice: 900 });
    const active = await createProductDirect(db, { brandId: brand.id, categoryId: category.id, name: 'Aaa First', baseSku: 'NO-AAA', defaultPrice: 900 });
    await createVariantDirect(db, { productId: active.id, size: 'XL', colorName: 'Black', sku: 'NO-AAA-XL-BLACK', sellPrice: 900, isActive: false });
    await createVariantDirect(db, { productId: active.id, size: 'XS', colorName: 'Black', sku: 'NO-AAA-XS-BLACK', sellPrice: 900 });
    const { body } = await low(cookie);
    expect(body.low.map((v: { id: string }) => v.id)).toEqual([b.id]);
    expect(body.out.map((v: { sku: string }) => v.sku)).toEqual(['NO-AAA-XS-BLACK', c.sku]);
  });

  it('is readable by a SELLER without cost fields', async () => {
    const { sellerCookie } = await fixture();
    const { status, body } = await low(sellerCookie);
    expect(status).toBe(200);
    expect(body.low).toHaveLength(1);
    expectNoSellerKeys(body);
  });
});
