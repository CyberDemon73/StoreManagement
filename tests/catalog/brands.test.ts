import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/v1/brands/route';
import { PATCH } from '@/app/api/v1/brands/[id]/route';
import { getDb } from '@/db/client';
import { auditLog, products } from '@/db/schema';
import { call } from '../helpers/http';
import { createProductDirect, createVariantDirect, seedCatalog } from '../helpers/catalog';
import { createUser, sessionCookieFor } from '../helpers/users';

const MISSING_ID = '00000000-0000-4000-8000-0000000000ff';

async function manager() {
  const db = getDb();
  const m = await createUser(db, { role: 'MANAGER' });
  return { db, m, cookie: await sessionCookieFor(db, m.id) };
}

describe('brands', () => {
  it('MANAGER creates a brand (201, isActive:true) and writes an audit row', async () => {
    const { db, m, cookie } = await manager();
    const res = await call(POST, { method: 'POST', path: '/api/v1/brands', cookie, body: { name: 'Northline' } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ name: 'Northline', isActive: true, productCount: 0, variantCount: 0 });
    expect(body.id).toBeTypeOf('string');
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'brand.create'), eq(auditLog.entityId, body.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: m.id, entity: 'brand', before: null });
    expect(rows[0]?.after).toMatchObject({ name: 'Northline' });
  });

  it('list includes productCount (ACTIVE products) and variantCount', async () => {
    const { db, cookie } = await manager();
    const { brand, category } = await seedCatalog(db);
    let res = await call(GET, { path: '/api/v1/brands', cookie });
    expect(res.status).toBe(200);
    expect((await res.json()).find((b: { id: string }) => b.id === brand.id)).toMatchObject({
      productCount: 0,
      variantCount: 0,
    });

    const p = await createProductDirect(db, { name: 'Chino', baseSku: 'NO-CHI', brandId: brand.id, categoryId: category.id, defaultPrice: 1000 });
    await createVariantDirect(db, { productId: p.id, size: 'M', colorName: 'Navy', sku: 'NO-CHI-M-NAVY', sellPrice: 1000 });
    await createVariantDirect(db, { productId: p.id, size: 'L', colorName: 'Navy', sku: 'NO-CHI-L-NAVY', sellPrice: 1000 });
    await createProductDirect(db, { name: 'Old', baseSku: 'NO-OLD', brandId: brand.id, categoryId: category.id, defaultPrice: 1000, status: 'ARCHIVED' });

    res = await call(GET, { path: '/api/v1/brands', cookie });
    expect((await res.json()).find((b: { id: string }) => b.id === brand.id)).toMatchObject({
      productCount: 1,
      variantCount: 2,
    });
  });

  it('duplicate name returns 409 with fields.name', async () => {
    const { cookie } = await manager();
    await call(POST, { method: 'POST', path: '/api/v1/brands', cookie, body: { name: 'Northline' } });
    const res = await call(POST, { method: 'POST', path: '/api/v1/brands', cookie, body: { name: 'Northline' } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.fields.name).toBeDefined();
  });

  it('PATCH isActive:false keeps the brand listed and products still reference it', async () => {
    const { db, m, cookie } = await manager();
    const { brand, category } = await seedCatalog(db);
    const p = await createProductDirect(db, { name: 'Chino', baseSku: 'NO-CHI', brandId: brand.id, categoryId: category.id, defaultPrice: 1000 });
    const res = await call(PATCH, {
      method: 'PATCH',
      path: `/api/v1/brands/${brand.id}`,
      cookie,
      params: { id: brand.id },
      body: { isActive: false },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: brand.id, isActive: false, productCount: 1 });

    const list = await (await call(GET, { path: '/api/v1/brands', cookie })).json();
    expect(list.find((b: { id: string }) => b.id === brand.id)).toMatchObject({ id: brand.id, isActive: false });
    const [prod] = await db.select().from(products).where(eq(products.id, p.id));
    expect(prod?.brandId).toBe(brand.id);

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'brand.update'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: m.id, entityId: brand.id, before: { isActive: true }, after: { isActive: false } });
  });

  it('PATCH to a name another brand uses returns 409', async () => {
    const { cookie } = await manager();
    await call(POST, { method: 'POST', path: '/api/v1/brands', cookie, body: { name: 'A' } });
    const b = await (await call(POST, { method: 'POST', path: '/api/v1/brands', cookie, body: { name: 'B' } })).json();
    const res = await call(PATCH, { method: 'PATCH', path: `/api/v1/brands/${b.id}`, cookie, params: { id: b.id }, body: { name: 'A' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields.name).toBeDefined();
  });

  it('SELLER can GET (200) but not POST (403)', async () => {
    const db = getDb();
    const s = await createUser(db, { role: 'SELLER' });
    const cookie = await sessionCookieFor(db, s.id);
    expect((await call(GET, { path: '/api/v1/brands', cookie })).status).toBe(200);
    const res = await call(POST, { method: 'POST', path: '/api/v1/brands', cookie, body: { name: 'X' } });
    expect(res.status).toBe(403);
  });

  it('PATCH unknown id returns 404', async () => {
    const { cookie } = await manager();
    const res = await call(PATCH, {
      method: 'PATCH',
      path: `/api/v1/brands/${MISSING_ID}`,
      cookie,
      params: { id: MISSING_ID },
      body: { name: 'Y' },
    });
    expect(res.status).toBe(404);
  });

  it('extra field or malformed id returns 400', async () => {
    const { cookie } = await manager();
    const res = await call(POST, { method: 'POST', path: '/api/v1/brands', cookie, body: { name: 'X', extra: 1 } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.extra).toBeDefined();
    const bad = await call(PATCH, { method: 'PATCH', path: '/api/v1/brands/nope', cookie, params: { id: 'nope' }, body: { name: 'Y' } });
    expect(bad.status).toBe(400);
  });
});
