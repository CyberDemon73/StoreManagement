import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/v1/categories/route';
import { PATCH } from '@/app/api/v1/categories/[id]/route';
import { getDb } from '@/db/client';
import { auditLog, products } from '@/db/schema';
import { call } from '../helpers/http';
import { createProductDirect, seedCatalog } from '../helpers/catalog';
import { createUser, sessionCookieFor } from '../helpers/users';

const MISSING_ID = '00000000-0000-4000-8000-0000000000ff';

async function manager() {
  const db = getDb();
  const m = await createUser(db, { role: 'MANAGER' });
  return { db, m, cookie: await sessionCookieFor(db, m.id) };
}

describe('categories', () => {
  it('MANAGER creates a category (201, isActive:true) and writes an audit row', async () => {
    const { db, m, cookie } = await manager();
    const res = await call(POST, { method: 'POST', path: '/api/v1/categories', cookie, body: { name: 'Tops' } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ name: 'Tops', isActive: true, productCount: 0 });
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'category.create'), eq(auditLog.entityId, body.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: m.id, entity: 'category' });
  });

  it('creates a child category under an existing parent', async () => {
    const { cookie } = await manager();
    const parent = await (await call(POST, { method: 'POST', path: '/api/v1/categories', cookie, body: { name: 'Men' } })).json();
    const res = await call(POST, { method: 'POST', path: '/api/v1/categories', cookie, body: { name: 'Shirts', parentId: parent.id } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'Shirts', parentId: parent.id });
  });

  it('list includes productCount of ACTIVE products', async () => {
    const { db, cookie } = await manager();
    const { brand, category } = await seedCatalog(db);
    let list = await (await call(GET, { path: '/api/v1/categories', cookie })).json();
    expect(list.find((c: { id: string }) => c.id === category.id)).toMatchObject({ productCount: 0 });
    await createProductDirect(db, { name: 'Tee', baseSku: 'NO-TEE', brandId: brand.id, categoryId: category.id, defaultPrice: 500 });
    await createProductDirect(db, { name: 'Old', baseSku: 'NO-OLD', brandId: brand.id, categoryId: category.id, defaultPrice: 500, status: 'ARCHIVED' });
    list = await (await call(GET, { path: '/api/v1/categories', cookie })).json();
    expect(list.find((c: { id: string }) => c.id === category.id)).toMatchObject({ productCount: 1 });
  });

  it('duplicate name (same parent) returns 409 with fields.name', async () => {
    const { cookie } = await manager();
    await call(POST, { method: 'POST', path: '/api/v1/categories', cookie, body: { name: 'Tops' } });
    const res = await call(POST, { method: 'POST', path: '/api/v1/categories', cookie, body: { name: 'Tops' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields.name).toBeDefined();
  });

  it('PATCH isActive:false keeps the category listed and products still reference it', async () => {
    const { db, cookie } = await manager();
    const { brand, category } = await seedCatalog(db);
    const p = await createProductDirect(db, { name: 'Tee', baseSku: 'NO-TEE', brandId: brand.id, categoryId: category.id, defaultPrice: 500 });
    const res = await call(PATCH, {
      method: 'PATCH',
      path: `/api/v1/categories/${category.id}`,
      cookie,
      params: { id: category.id },
      body: { isActive: false },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: category.id, isActive: false });
    const list = await (await call(GET, { path: '/api/v1/categories', cookie })).json();
    expect(list.find((c: { id: string }) => c.id === category.id)).toMatchObject({ isActive: false });
    const [prod] = await db.select().from(products).where(eq(products.id, p.id));
    expect(prod?.categoryId).toBe(category.id);
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'category.update'));
    expect(rows[0]).toMatchObject({ entityId: category.id, before: { isActive: true }, after: { isActive: false } });
  });

  it('parentId equal to itself returns 400 with fields.parentId', async () => {
    const { db, cookie } = await manager();
    const { category } = await seedCatalog(db);
    const res = await call(PATCH, {
      method: 'PATCH',
      path: `/api/v1/categories/${category.id}`,
      cookie,
      params: { id: category.id },
      body: { parentId: category.id },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.parentId).toBeDefined();
  });

  it('unknown parentId returns 404 on create and patch', async () => {
    const { db, cookie } = await manager();
    const { category } = await seedCatalog(db);
    const res = await call(POST, { method: 'POST', path: '/api/v1/categories', cookie, body: { name: 'Orphan', parentId: MISSING_ID } });
    expect(res.status).toBe(404);
    const res2 = await call(PATCH, {
      method: 'PATCH',
      path: `/api/v1/categories/${category.id}`,
      cookie,
      params: { id: category.id },
      body: { parentId: MISSING_ID },
    });
    expect(res2.status).toBe(404);
  });

  it('SELLER can GET (200) but not POST (403)', async () => {
    const db = getDb();
    const s = await createUser(db, { role: 'SELLER' });
    const cookie = await sessionCookieFor(db, s.id);
    expect((await call(GET, { path: '/api/v1/categories', cookie })).status).toBe(200);
    expect((await call(POST, { method: 'POST', path: '/api/v1/categories', cookie, body: { name: 'X' } })).status).toBe(403);
  });

  it('PATCH unknown id returns 404; extra field returns 400', async () => {
    const { cookie } = await manager();
    const res = await call(PATCH, {
      method: 'PATCH',
      path: `/api/v1/categories/${MISSING_ID}`,
      cookie,
      params: { id: MISSING_ID },
      body: { name: 'Y' },
    });
    expect(res.status).toBe(404);
    const bad = await call(POST, { method: 'POST', path: '/api/v1/categories', cookie, body: { name: 'X', extra: true } });
    expect(bad.status).toBe(400);
  });
});
