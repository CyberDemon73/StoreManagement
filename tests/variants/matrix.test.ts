import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/v1/products/[id]/variants/route';
import { getDb } from '@/db/client';
import { auditLog, stockMovements, variants } from '@/db/schema';
import { createProductDirect, createVariantDirect, expectNoSellerKeys, seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000009';

async function fixture() {
  const db = getDb();
  const { brand, category } = await seedCatalog(db);
  const product = await createProductDirect(db, { name: 'Chino Slim', baseSku: 'NO-CHI', brandId: brand.id, categoryId: category.id, defaultPrice: 1000, defaultCost: 600 });
  await createVariantDirect(db, { productId: product.id, size: 'S', colorName: 'Black', sku: 'NO-CHI-S-BLACK', sellPrice: 1000, costPrice: 600 });
  await createVariantDirect(db, { productId: product.id, size: 'M', colorName: 'Black', sku: 'NO-CHI-M-BLACK', sellPrice: 1000, costPrice: 600 });
  const manager = await createUser(db, { role: 'MANAGER' });
  const cookie = await sessionCookieFor(db, manager.id);
  const seller = await createUser(db, { role: 'SELLER' });
  const sellerCookie = await sessionCookieFor(db, seller.id);
  return { db, product, cookie, sellerCookie };
}

describe('POST /products/:id/variants', () => {
  it('adds only the missing cells of the matrix and books INITIAL stock for each', async () => {
    const { db, product, cookie } = await fixture();
    const res = await call(POST, {
      method: 'POST',
      path: `/api/v1/products/${product.id}/variants`,
      cookie,
      params: { id: product.id },
      body: { sizes: ['M', 'L'], colors: [{ name: 'Black', hex: '#000000' }, { name: 'Navy Blue', hex: '#1f2a44' }], initialQty: 3, costPrice: 450, sellPrice: 1200 },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    // M|Black already exists: the other three cells are created, nothing conflicts.
    expect(body.map((v: { sku: string }) => v.sku).sort()).toEqual(['NO-CHI-L-BLACK', 'NO-CHI-L-NAVYBLUE', 'NO-CHI-M-NAVYBLUE']);
    for (const v of body) {
      expect(v).toMatchObject({ productId: product.id, quantity: 3, costPrice: 450, sellPrice: 1200, lowStockThreshold: 3, isActive: true });
      expect(v.color).toHaveProperty('hex');
    }
    const movements = await db.select().from(stockMovements);
    expect(movements).toHaveLength(3);
    expect(movements.every((m) => m.type === 'INITIAL' && m.qtyDelta === 3 && m.unitCost === 450)).toBe(true);
    const all = await db.select().from(variants).where(eq(variants.productId, product.id));
    expect(all).toHaveLength(5);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'variant.create'));
    expect(audits).toHaveLength(1);
  });

  it('returns [] when every cell already exists and 404/400 for unknown or malformed product ids', async () => {
    const { product, cookie } = await fixture();
    const body = { sizes: ['S'], colors: [{ name: 'Black', hex: '#000000' }] };
    const none = await call(POST, { method: 'POST', path: `/api/v1/products/${product.id}/variants`, cookie, params: { id: product.id }, body });
    expect(none.status).toBe(201);
    expect(await none.json()).toEqual([]);
    expect((await call(POST, { method: 'POST', path: `/api/v1/products/${UNKNOWN_ID}/variants`, cookie, params: { id: UNKNOWN_ID }, body })).status).toBe(404);
    expect((await call(POST, { method: 'POST', path: '/api/v1/products/abc/variants', cookie, params: { id: 'abc' }, body })).status).toBe(400);
    expect((await call(POST, { method: 'POST', path: `/api/v1/products/${product.id}/variants`, cookie, params: { id: product.id }, body: { ...body, quantity: 1 } })).status).toBe(400);
  });

  it('returns 403 for a SELLER', async () => {
    const { product, sellerCookie } = await fixture();
    const res = await call(POST, {
      method: 'POST',
      path: `/api/v1/products/${product.id}/variants`,
      cookie: sellerCookie,
      params: { id: product.id },
      body: { sizes: ['L'], colors: [{ name: 'Black', hex: '#000000' }] },
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /products/:id/variants', () => {
  it('lists the variants, cost-stripped for a SELLER', async () => {
    const { product, cookie, sellerCookie } = await fixture();
    const m = await call(GET, { path: `/api/v1/products/${product.id}/variants`, cookie, params: { id: product.id } });
    expect(m.status).toBe(200);
    const mb = await m.json();
    expect(mb).toHaveLength(2);
    expect(mb[0].costPrice).toBe(600);
    const s = await call(GET, { path: `/api/v1/products/${product.id}/variants`, cookie: sellerCookie, params: { id: product.id } });
    expect(s.status).toBe(200);
    const sb = await s.json();
    expect(sb).toHaveLength(2);
    expectNoSellerKeys(sb);
    expect((await call(GET, { path: `/api/v1/products/${UNKNOWN_ID}/variants`, cookie, params: { id: UNKNOWN_ID } })).status).toBe(404);
  });
});
