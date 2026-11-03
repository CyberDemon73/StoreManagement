import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/products/route';
import { getDb } from '@/db/client';
import { brands, products } from '@/db/schema';
import { createProductDirect, createVariantDirect, expectNoSellerKeys, seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

const BARCODE = '6221234567890';

/** 3 ACTIVE products (qty 0 / 2 / 50, threshold 3), 1 ARCHIVED, two brands, deterministic updatedAt. */
async function fixture() {
  const db = getDb();
  const { brand, category } = await seedCatalog(db);
  const [brandB] = await db.insert(brands).values({ name: 'Verano' }).returning();
  const base = { brandId: brand.id, categoryId: category.id };
  const chino = await createProductDirect(db, { ...base, name: 'Chino Slim', baseSku: 'NO-CHI', defaultPrice: 1000, defaultCost: 600 });
  const shirt = await createProductDirect(db, { ...base, brandId: brandB!.id, name: 'Linen Shirt', baseSku: 'VE-LIN', defaultPrice: 2000 });
  const coat = await createProductDirect(db, { ...base, name: 'Wool Coat', baseSku: 'NO-WOO', defaultPrice: 5000, defaultCost: 3000 });
  const old = await createProductDirect(db, { ...base, brandId: brandB!.id, name: 'Old Thing', baseSku: 'VE-OLD', defaultPrice: 10, status: 'ARCHIVED' });
  await createVariantDirect(db, { productId: chino.id, size: 'S', colorName: 'Black', sku: 'NO-CHI-S-BLACK', sellPrice: 1000, costPrice: 600, quantity: 0, barcode: BARCODE });
  await createVariantDirect(db, { productId: shirt.id, size: 'M', colorName: 'White', colorHex: '#ffffff', sku: 'VE-LIN-M-WHITE', sellPrice: 2000, quantity: 2 });
  await createVariantDirect(db, { productId: coat.id, size: 'L', colorName: 'Grey', colorHex: '#888888', sku: 'NO-WOO-L-GREY', sellPrice: 4500, costPrice: 3000, quantity: 50 });
  // Inactive variants never count: a cheap, out-of-stock cell must not drag the coat into stock=out.
  await createVariantDirect(db, { productId: coat.id, size: 'XL', colorName: 'Grey', colorHex: '#888888', sku: 'NO-WOO-XL-GREY', sellPrice: 100, quantity: 0, isActive: false });
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  for (const [i, p] of [chino, shirt, coat, old].entries()) {
    await db.update(products).set({ updatedAt: new Date(t0 + i * 60_000) }).where(eq(products.id, p.id));
  }
  const manager = await createUser(db, { role: 'MANAGER' });
  const cookie = await sessionCookieFor(db, manager.id);
  return { db, brand, brandB: brandB!, chino, shirt, coat, old, cookie };
}

async function list(cookie: string, qs = '') {
  const res = await call(GET, { path: `/api/v1/products${qs}`, cookie });
  return { status: res.status, body: await res.json() };
}

const names = (body: { data: { name: string }[] }) => body.data.map((p) => p.name);

describe('GET /products', () => {
  it('lists ACTIVE products newest-updated first with aggregates and pagination meta', async () => {
    const { cookie, coat } = await fixture();
    const { status, body } = await list(cookie);
    expect(status).toBe(200);
    expect(body).toMatchObject({ page: 1, pageSize: 25, total: 3 });
    expect(names(body)).toEqual(['Wool Coat', 'Linen Shirt', 'Chino Slim']);
    const coatRow = body.data.find((p: { id: string }) => p.id === coat.id);
    expect(coatRow).toMatchObject({
      brand: { name: 'Northline' },
      category: { name: 'Tops' },
      variantCount: 1,
      totalQty: 50,
      lowCount: 0,
      outCount: 0,
      minPrice: 4500,
      maxPrice: 4500,
      lowStock: false,
      tint: '#888888',
      marginPct: 40,
    });
    expect(coatRow.variants).toBeUndefined();
    const chinoRow = body.data.find((p: { name: string }) => p.name === 'Chino Slim');
    expect(chinoRow).toMatchObject({ totalQty: 0, outCount: 1, lowStock: true, tint: '#000000' });
    const shirtRow = body.data.find((p: { name: string }) => p.name === 'Linen Shirt');
    expect(shirtRow).toMatchObject({ totalQty: 2, lowCount: 1, lowStock: true });
    expect(shirtRow.marginPct).toBeUndefined();
  });

  it('searches by name, brand, variant SKU and exact barcode', async () => {
    const { cookie } = await fixture();
    expect(names((await list(cookie, '?q=chi')).body)).toEqual(['Chino Slim']);
    expect(names((await list(cookie, '?q=verano')).body)).toEqual(['Linen Shirt']);
    expect(names((await list(cookie, '?q=VE-LIN-M')).body)).toEqual(['Linen Shirt']);
    expect(names((await list(cookie, `?q=${BARCODE}`)).body)).toEqual(['Chino Slim']);
    expect(names((await list(cookie, `?q=${BARCODE.slice(0, 6)}`)).body)).toEqual([]);
  });

  it('never 500s on hostile q: injection text, wildcards and oversized input', async () => {
    const { cookie } = await fixture();
    const inj = await list(cookie, `?q=${encodeURIComponent("' OR 1=1 --")}`);
    expect(inj.status).toBe(200);
    expect(inj.body.data).toEqual([]);
    const pct = await list(cookie, '?q=%25');
    expect(pct.status).toBe(200);
    expect(pct.body.total).toBe(0);
    const underscore = await list(cookie, '?q=_');
    expect(underscore.status).toBe(200);
    expect(underscore.body.total).toBe(0);
    const backslash = await list(cookie, '?q=%5C');
    expect(backslash.status).toBe(200);
    expect(backslash.body.total).toBe(0);
    const huge = await list(cookie, `?q=${'a'.repeat(10_240)}`);
    expect(huge.status).toBe(400);
  });

  it('filters by stock state, brand, size/color and price range', async () => {
    const { cookie, brandB } = await fixture();
    expect(names((await list(cookie, '?stock=out')).body)).toEqual(['Chino Slim']);
    expect(names((await list(cookie, '?stock=low')).body)).toEqual(['Linen Shirt']);
    expect(names((await list(cookie, '?stock=in')).body)).toEqual(['Wool Coat']);
    expect(names((await list(cookie, `?brandId=${brandB.id}`)).body)).toEqual(['Linen Shirt']);
    expect(names((await list(cookie, '?size=m')).body)).toEqual(['Linen Shirt']);
    expect(names((await list(cookie, '?color=grey')).body)).toEqual(['Wool Coat']);
    expect(names((await list(cookie, '?minPrice=1500&maxPrice=3000')).body)).toEqual(['Linen Shirt']);
    expect(names((await list(cookie, '?minPrice=4600')).body)).toEqual([]);
  });

  it('sorts by the whitelist only', async () => {
    const { cookie } = await fixture();
    expect(names((await list(cookie, '?sort=price')).body)).toEqual(['Chino Slim', 'Linen Shirt', 'Wool Coat']);
    expect(names((await list(cookie, '?sort=-price')).body)).toEqual(['Wool Coat', 'Linen Shirt', 'Chino Slim']);
    expect(names((await list(cookie, '?sort=-qty')).body)).toEqual(['Wool Coat', 'Linen Shirt', 'Chino Slim']);
    expect(names((await list(cookie, '?sort=name')).body)).toEqual(['Chino Slim', 'Linen Shirt', 'Wool Coat']);
    expect(names((await list(cookie, '?sort=updated')).body)).toEqual(['Chino Slim', 'Linen Shirt', 'Wool Coat']);
    expect((await list(cookie, '?sort=price-asc')).status).toBe(400);
    expect((await list(cookie, '?sort=updated_at;drop')).status).toBe(400);
  });

  it('filters by status including ARCHIVED and ALL', async () => {
    const { cookie } = await fixture();
    expect(names((await list(cookie, '?status=ARCHIVED')).body)).toEqual(['Old Thing']);
    const all = await list(cookie, '?status=ALL');
    expect(all.body.total).toBe(4);
    expect(names(all.body)).toEqual(['Old Thing', 'Wool Coat', 'Linen Shirt', 'Chino Slim']);
  });

  it('paginates and rejects an out-of-range pageSize or unknown query key', async () => {
    const { cookie } = await fixture();
    const page2 = await list(cookie, '?pageSize=2&page=2');
    expect(page2.status).toBe(200);
    expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(names(page2.body)).toEqual(['Chino Slim']);
    expect((await list(cookie, '?pageSize=500')).status).toBe(400);
    expect((await list(cookie, '?page=0')).status).toBe(400);
    expect((await list(cookie, '?foo=1')).status).toBe(400);
  });

  it('strips cost fields for a SELLER and returns 401 anonymously', async () => {
    const { db, cookie } = await fixture();
    const seller = await createUser(db, { role: 'SELLER' });
    const s = await list(await sessionCookieFor(db, seller.id));
    expect(s.status).toBe(200);
    expect(s.body.total).toBe(3);
    expectNoSellerKeys(s.body);
    const m = await list(cookie);
    expect(m.body.data.some((p: { marginPct?: number }) => p.marginPct !== undefined)).toBe(true);
    expect((await call(GET, { path: '/api/v1/products' })).status).toBe(401);
  });

  it('reports the real total when the page is past the end', async () => {
    const { cookie } = await fixture();
    const r = await list(cookie, '?page=5&pageSize=2');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ data: [], page: 5, pageSize: 2, total: 3 });
  });

  it('q does not match an inactive variant SKU', async () => {
    const { db, coat, cookie } = await fixture();
    await createVariantDirect(db, { productId: coat.id, size: 'XS', colorName: 'Grey', colorHex: '#888888', sku: 'ZZZ-INACTIVE', sellPrice: 4500, quantity: 5, isActive: false });
    const r = await list(cookie, '?q=ZZZ-INACTIVE');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('stock=in excludes a product with any out-of-stock cell', async () => {
    const { db, coat, cookie } = await fixture();
    await createVariantDirect(db, { productId: coat.id, size: 'M', colorName: 'Grey', colorHex: '#888888', sku: 'NO-WOO-M-GREY', sellPrice: 4500, quantity: 0, lowStockThreshold: 0 });
    expect(names((await list(cookie, '?stock=in')).body)).toEqual([]);
    expect(names((await list(cookie, '?stock=out')).body)).toContain('Wool Coat');
  });
});
