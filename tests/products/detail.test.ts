import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as ARCHIVE } from '@/app/api/v1/products/[id]/archive/route';
import { GET, PATCH } from '@/app/api/v1/products/[id]/route';
import { POST as UNARCHIVE } from '@/app/api/v1/products/[id]/unarchive/route';
import { POST as CREATE } from '@/app/api/v1/products/route';
import { getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { expectNoSellerKeys, seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000009';

async function fixture() {
  const db = getDb();
  const cat = await seedCatalog(db);
  const manager = await createUser(db, { role: 'MANAGER' });
  const cookie = await sessionCookieFor(db, manager.id);
  const seller = await createUser(db, { role: 'SELLER' });
  const sellerCookie = await sessionCookieFor(db, seller.id);
  const res = await call(CREATE, {
    method: 'POST',
    path: '/api/v1/products',
    cookie,
    body: {
      name: 'Chino Slim',
      brandId: cat.brand.id,
      categoryId: cat.category.id,
      defaultPrice: 1000,
      defaultCost: 600,
      variants: { sizes: ['S'], colors: [{ name: 'Black', hex: '#000000' }], initialQty: 2, costPrice: 400 },
    },
  });
  expect(res.status).toBe(201);
  const product = await res.json();
  return { db, ...cat, cookie, sellerCookie, product };
}

describe('GET /products/:id', () => {
  it('returns the full detail to a MANAGER and a cost-stripped one to a SELLER', async () => {
    const { product, cookie, sellerCookie } = await fixture();
    const m = await call(GET, { path: `/api/v1/products/${product.id}`, cookie, params: { id: product.id } });
    expect(m.status).toBe(200);
    const mb = await m.json();
    expect(mb.defaultCost).toBe(600);
    expect(mb.variants[0].costPrice).toBe(400);
    expect(mb.marginPct).toBe(40);
    expect(mb.lowStock).toBe(true);
    expect(mb.lowCount).toBe(1);

    const s = await call(GET, { path: `/api/v1/products/${product.id}`, cookie: sellerCookie, params: { id: product.id } });
    expect(s.status).toBe(200);
    const sb = await s.json();
    expectNoSellerKeys(sb);
    expect(sb.variants).toHaveLength(1);
    expect(sb.variants[0].sellPrice).toBe(1000);
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const { cookie } = await fixture();
    expect((await call(GET, { path: `/api/v1/products/${UNKNOWN_ID}`, cookie, params: { id: UNKNOWN_ID } })).status).toBe(404);
    expect((await call(GET, { path: '/api/v1/products/abc', cookie, params: { id: 'abc' } })).status).toBe(400);
  });
});

describe('PATCH /products/:id', () => {
  it('updates fields and audits before/after', async () => {
    const { db, product, cookie } = await fixture();
    const res = await call(PATCH, { method: 'PATCH', path: `/api/v1/products/${product.id}`, cookie, params: { id: product.id }, body: { name: 'Chino Wide' } });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('Chino Wide');
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'product.update'));
    expect(row).toBeDefined();
    expect((row!.before as { name: string }).name).toBe('Chino Slim');
    expect((row!.after as { name: string }).name).toBe('Chino Wide');
  });

  it('rejects a variants key, a malformed id and an unknown product', async () => {
    const { product, cookie } = await fixture();
    const withVariants = await call(PATCH, {
      method: 'PATCH',
      path: `/api/v1/products/${product.id}`,
      cookie,
      params: { id: product.id },
      body: { variants: { sizes: ['L'], colors: [{ name: 'Red', hex: '#ff0000' }] } },
    });
    expect(withVariants.status).toBe(400);
    expect((await call(PATCH, { method: 'PATCH', path: '/api/v1/products/abc', cookie, params: { id: 'abc' }, body: { name: 'x' } })).status).toBe(400);
    expect((await call(PATCH, { method: 'PATCH', path: `/api/v1/products/${UNKNOWN_ID}`, cookie, params: { id: UNKNOWN_ID }, body: { name: 'x' } })).status).toBe(404);
  });

  it('changing baseSku does not rename variant SKUs and a conflict is 409', async () => {
    const { brand, category, product, cookie } = await fixture();
    const other = await call(CREATE, {
      method: 'POST',
      path: '/api/v1/products',
      cookie,
      body: { name: 'Other', brandId: brand.id, categoryId: category.id, defaultPrice: 1, baseSku: 'OT-HER' },
    });
    expect(other.status).toBe(201);
    const ok = await call(PATCH, { method: 'PATCH', path: `/api/v1/products/${product.id}`, cookie, params: { id: product.id }, body: { baseSku: 'NEW-ONE' } });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.baseSku).toBe('NEW-ONE');
    expect(body.variants[0].sku).toBe('NO-CHI-S-BLACK');
    const conflict = await call(PATCH, { method: 'PATCH', path: `/api/v1/products/${product.id}`, cookie, params: { id: product.id }, body: { baseSku: 'OT-HER' } });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.fields.baseSku).toBeDefined();
  });

  it('returns 403 for a SELLER', async () => {
    const { product, sellerCookie } = await fixture();
    const res = await call(PATCH, { method: 'PATCH', path: `/api/v1/products/${product.id}`, cookie: sellerCookie, params: { id: product.id }, body: { name: 'x' } });
    expect(res.status).toBe(403);
  });
});

describe('POST /products/:id/archive and /unarchive', () => {
  it('toggles status and audits', async () => {
    const { db, product, cookie } = await fixture();
    const a = await call(ARCHIVE, { method: 'POST', path: `/api/v1/products/${product.id}/archive`, cookie, params: { id: product.id } });
    expect(a.status).toBe(200);
    expect((await a.json()).status).toBe('ARCHIVED');
    const u = await call(UNARCHIVE, { method: 'POST', path: `/api/v1/products/${product.id}/unarchive`, cookie, params: { id: product.id } });
    expect(u.status).toBe(200);
    expect((await u.json()).status).toBe('ACTIVE');
    const rows = await db.select().from(auditLog);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['product.archive', 'product.unarchive']));
    expect((await call(ARCHIVE, { method: 'POST', path: `/api/v1/products/${UNKNOWN_ID}/archive`, cookie, params: { id: UNKNOWN_ID } })).status).toBe(404);
  });

  it('returns 403 for a SELLER', async () => {
    const { product, sellerCookie } = await fixture();
    const res = await call(ARCHIVE, { method: 'POST', path: `/api/v1/products/${product.id}/archive`, cookie: sellerCookie, params: { id: product.id } });
    expect(res.status).toBe(403);
  });
});
