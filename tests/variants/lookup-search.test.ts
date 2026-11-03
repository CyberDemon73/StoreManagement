import { describe, expect, it } from 'vitest';
import { GET as LOOKUP } from '@/app/api/v1/variants/lookup/route';
import { GET as SEARCH } from '@/app/api/v1/variants/search/route';
import { getDb } from '@/db/client';
import { createProductDirect, createVariantDirect, expectNoSellerKeys, seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

const BARCODE = '6221000000001';

async function fixture() {
  const db = getDb();
  const { brand, category } = await seedCatalog(db);
  const base = { brandId: brand.id, categoryId: category.id };
  const chino = await createProductDirect(db, { ...base, name: 'Chino Slim', baseSku: 'NO-CHI', defaultPrice: 1000, defaultCost: 600, images: ['https://cdn.example.com/chino.jpg'] });
  const old = await createProductDirect(db, { ...base, name: 'Chino Classic', baseSku: 'NO-OLD', defaultPrice: 900, status: 'ARCHIVED' });
  await createVariantDirect(db, { productId: chino.id, size: 'S', colorName: 'Black', sku: 'NO-CHI-S-BLACK', sellPrice: 1000, costPrice: 600, barcode: BARCODE, quantity: 4 });
  await createVariantDirect(db, { productId: chino.id, size: 'M', colorName: 'Navy', colorHex: '#1f2a44', sku: 'NO-CHI-M-NAVY', sellPrice: 1000, costPrice: 600 });
  await createVariantDirect(db, { productId: chino.id, size: 'L', colorName: 'Navy', colorHex: '#1f2a44', sku: 'NO-CHI-L-NAVY', sellPrice: 1000, costPrice: 600 });
  await createVariantDirect(db, { productId: old.id, size: 'S', colorName: 'Black', sku: 'NO-OLD-S-BLACK', sellPrice: 900 });
  const manager = await createUser(db, { role: 'MANAGER' });
  const cookie = await sessionCookieFor(db, manager.id);
  const seller = await createUser(db, { role: 'SELLER' });
  const sellerCookie = await sessionCookieFor(db, seller.id);
  return { db, chino, old, cookie, sellerCookie };
}

describe('GET /variants/lookup', () => {
  it('finds by case-insensitive sku or exact barcode and embeds the product summary', async () => {
    const { chino, cookie } = await fixture();
    const bySku = await call(LOOKUP, { path: '/api/v1/variants/lookup?sku=no-chi-s-black', cookie });
    expect(bySku.status).toBe(200);
    const body = await bySku.json();
    expect(body).toMatchObject({ sku: 'NO-CHI-S-BLACK', quantity: 4, costPrice: 600, color: { name: 'Black', hex: '#000000' } });
    expect(body.product).toEqual({ id: chino.id, name: 'Chino Slim', baseSku: 'NO-CHI', images: ['https://cdn.example.com/chino.jpg'], brandName: 'Northline', tint: '#000000' });
    const byBarcode = await call(LOOKUP, { path: `/api/v1/variants/lookup?barcode=${BARCODE}`, cookie });
    expect(byBarcode.status).toBe(200);
    expect((await byBarcode.json()).sku).toBe('NO-CHI-S-BLACK');
    // Archived products stay scannable (returns/stock history), so lookup does not filter by status.
    expect((await call(LOOKUP, { path: '/api/v1/variants/lookup?sku=NO-OLD-S-BLACK', cookie })).status).toBe(200);
  });

  it('returns 404 when nothing matches, 400 without a parameter or with an unknown one', async () => {
    const { cookie } = await fixture();
    expect((await call(LOOKUP, { path: '/api/v1/variants/lookup?sku=NOPE', cookie })).status).toBe(404);
    expect((await call(LOOKUP, { path: `/api/v1/variants/lookup?barcode=${BARCODE.slice(0, 5)}`, cookie })).status).toBe(404);
    expect((await call(LOOKUP, { path: '/api/v1/variants/lookup', cookie })).status).toBe(400);
    expect((await call(LOOKUP, { path: '/api/v1/variants/lookup?id=1', cookie })).status).toBe(400);
  });

  it('strips cost fields for a SELLER', async () => {
    const { sellerCookie } = await fixture();
    const res = await call(LOOKUP, { path: '/api/v1/variants/lookup?sku=NO-CHI-S-BLACK', cookie: sellerCookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    expectNoSellerKeys(body);
    expect(body.product.brandName).toBe('Northline');
  });
});

describe('GET /variants/search', () => {
  it('matches product name, sku or exact barcode over ACTIVE products, ordered by sku and capped by limit', async () => {
    const { cookie } = await fixture();
    const byName = await call(SEARCH, { path: '/api/v1/variants/search?q=chino', cookie });
    expect(byName.status).toBe(200);
    const rows = await byName.json();
    expect(rows.map((v: { sku: string }) => v.sku)).toEqual(['NO-CHI-L-NAVY', 'NO-CHI-M-NAVY', 'NO-CHI-S-BLACK']);
    expect(rows[0].product).toMatchObject({ name: 'Chino Slim', brandName: 'Northline', tint: '#000000' });
    const limited = await call(SEARCH, { path: '/api/v1/variants/search?q=chino&limit=2', cookie });
    expect(await limited.json()).toHaveLength(2);
    const bySku = await call(SEARCH, { path: '/api/v1/variants/search?q=m-navy', cookie });
    expect((await bySku.json()).map((v: { sku: string }) => v.sku)).toEqual(['NO-CHI-M-NAVY']);
    const byBarcode = await call(SEARCH, { path: `/api/v1/variants/search?q=${BARCODE}`, cookie });
    expect((await byBarcode.json()).map((v: { sku: string }) => v.sku)).toEqual(['NO-CHI-S-BLACK']);
    const wildcard = await call(SEARCH, { path: '/api/v1/variants/search?q=%25', cookie });
    expect(wildcard.status).toBe(200);
    expect(await wildcard.json()).toEqual([]);
  });

  it('validates q and limit', async () => {
    const { cookie } = await fixture();
    expect((await call(SEARCH, { path: '/api/v1/variants/search', cookie })).status).toBe(400);
    expect((await call(SEARCH, { path: '/api/v1/variants/search?q=a&limit=51', cookie })).status).toBe(400);
    expect((await call(SEARCH, { path: `/api/v1/variants/search?q=${'a'.repeat(101)}`, cookie })).status).toBe(400);
  });

  it('strips cost fields for a SELLER and returns 401 anonymously', async () => {
    const { sellerCookie } = await fixture();
    const res = await call(SEARCH, { path: '/api/v1/variants/search?q=chino', cookie: sellerCookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(3);
    expectNoSellerKeys(body);
    expect((await call(SEARCH, { path: '/api/v1/variants/search?q=chino' })).status).toBe(401);
  });
});
