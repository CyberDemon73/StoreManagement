import { count, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/products/route';
import { getDb } from '@/db/client';
import { auditLog, products, stockMovements } from '@/db/schema';
import { seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

async function fixture() {
  const db = getDb();
  const cat = await seedCatalog(db);
  const manager = await createUser(db, { role: 'MANAGER' });
  const cookie = await sessionCookieFor(db, manager.id);
  return { db, ...cat, manager, cookie };
}

const matrix = {
  sizes: ['S', 'M'],
  colors: [
    { name: 'Black', hex: '#000000' },
    { name: 'Navy Blue', hex: '#1f2a44' },
  ],
  initialQty: { 'S|Black': 5 },
  costPrice: 400,
};

describe('POST /products', () => {
  it('creates a product with a size×color matrix and INITIAL movements only for stocked cells', async () => {
    const { db, brand, category, cookie } = await fixture();
    const res = await call(POST, {
      method: 'POST',
      path: '/api/v1/products',
      cookie,
      body: { name: 'Chino Slim', brandId: brand.id, categoryId: category.id, defaultPrice: 1000, defaultCost: 600, variants: matrix },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.baseSku).toBe('NO-CHI');
    expect(body.status).toBe('ACTIVE');
    expect(body.variants).toHaveLength(4);
    const skus = body.variants.map((v: { sku: string }) => v.sku);
    expect(skus).toContain('NO-CHI-S-BLACK');
    expect(skus).toContain('NO-CHI-M-NAVYBLUE');
    const stocked = body.variants.find((v: { sku: string }) => v.sku === 'NO-CHI-S-BLACK');
    expect(stocked).toMatchObject({ quantity: 5, costPrice: 400, sellPrice: 1000, color: { name: 'Black', hex: '#000000' } });
    for (const v of body.variants) if (v.sku !== 'NO-CHI-S-BLACK') expect(v.quantity).toBe(0);
    const movements = await db.select().from(stockMovements);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ variantId: stocked.id, type: 'INITIAL', qtyDelta: 5, unitCost: 400 });
    expect(body.tint).toBe('#000000');
    expect(body.sizes).toEqual(['S', 'M']);
    expect(body.colors).toHaveLength(2);
    expect(body).toMatchObject({ variantCount: 4, totalQty: 5, outCount: 3, lowCount: 0, minPrice: 1000, maxPrice: 1000, marginPct: 40 });
    expect(body.brand).toMatchObject({ id: brand.id, name: 'Northline' });
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'product.create'));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.entityId).toBe(body.id);
  });

  it('uppercases a supplied baseSku and creates no variants when the matrix is omitted', async () => {
    const { brand, category, cookie } = await fixture();
    const res = await call(POST, {
      method: 'POST',
      path: '/api/v1/products',
      cookie,
      body: { name: 'Chino Slim', brandId: brand.id, categoryId: category.id, defaultPrice: 1000, baseSku: 'nl-chi' },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.baseSku).toBe('NL-CHI');
    expect(body.variants).toEqual([]);
    expect(body).toMatchObject({ variantCount: 0, totalQty: 0, minPrice: 1000, maxPrice: 1000, tint: '#E6E3DC' });
    expect(body.marginPct).toBeUndefined();
  });

  it('returns 409 fields.baseSku on a duplicate base SKU and inserts nothing', async () => {
    const { db, brand, category, cookie } = await fixture();
    const body = { name: 'Chino Slim', brandId: brand.id, categoryId: category.id, defaultPrice: 1000, variants: matrix };
    expect((await call(POST, { method: 'POST', path: '/api/v1/products', cookie, body })).status).toBe(201);
    const dup = await call(POST, { method: 'POST', path: '/api/v1/products', cookie, body: { ...body, name: 'Chino Wide', baseSku: 'NO-CHI' } });
    expect(dup.status).toBe(409);
    const err = await dup.json();
    expect(err.error.code).toBe('CONFLICT');
    expect(err.error.fields.baseSku).toBeDefined();
    const [row] = await db.select({ n: count() }).from(products);
    expect(row!.n).toBe(1);
    expect(await db.select().from(stockMovements)).toHaveLength(1);
  });

  it('returns 404 for an unknown brand and 400 for an unknown field', async () => {
    const { category, cookie } = await fixture();
    const unknown = await call(POST, {
      method: 'POST',
      path: '/api/v1/products',
      cookie,
      body: { name: 'X', brandId: '00000000-0000-4000-8000-000000000001', categoryId: category.id, defaultPrice: 1 },
    });
    expect(unknown.status).toBe(404);
    const bad = await call(POST, { method: 'POST', path: '/api/v1/products', cookie, body: { name: 'X', defaultPrice: 1, quantity: 3 } });
    expect(bad.status).toBe(400);
  });

  it('returns 403 for a SELLER', async () => {
    const { db, brand, category } = await fixture();
    const seller = await createUser(db, { role: 'SELLER' });
    const res = await call(POST, {
      method: 'POST',
      path: '/api/v1/products',
      cookie: await sessionCookieFor(db, seller.id),
      body: { name: 'X', brandId: brand.id, categoryId: category.id, defaultPrice: 1 },
    });
    expect(res.status).toBe(403);
  });
});
