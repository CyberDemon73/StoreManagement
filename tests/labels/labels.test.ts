import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/labels/route';
import { getDb } from '@/db/client';
import { createProductDirect, createVariantDirect, expectNoSellerKeys, seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

async function fixture(role: 'MANAGER' | 'SELLER' | 'ADMIN' = 'MANAGER') {
  const db = getDb();
  const { brand, category } = await seedCatalog(db);
  const p = await createProductDirect(db, { name: 'Chino Slim', baseSku: 'NO-CHI', brandId: brand.id, categoryId: category.id, defaultPrice: 1000, defaultCost: 600, images: ['https://img.example/a.webp'] });
  const a = await createVariantDirect(db, { productId: p.id, size: 'S', colorName: 'Black', colorHex: '#111111', sku: 'NO-CHI-S-BLACK', barcode: '6220000000017', sellPrice: 1000, costPrice: 600, quantity: 3 });
  const b = await createVariantDirect(db, { productId: p.id, size: 'M', colorName: 'Black', colorHex: '#111111', sku: 'NO-CHI-M-BLACK', sellPrice: 1100, costPrice: 650 });
  const user = await createUser(db, { role });
  const cookie = await sessionCookieFor(db, user.id);
  return { db, p, a, b, cookie };
}

function labels(cookie: string, query: string) {
  return call(GET, { path: `/api/v1/labels${query}`, cookie });
}

describe('GET /labels', () => {
  it('returns VariantWithProduct in request order, omits unknown ids and never includes cost', async () => {
    const { p, a, b, cookie } = await fixture();
    const res = await labels(cookie, `?variantIds=${b.id},${randomUUID()},${a.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((v: { id: string }) => v.id)).toEqual([b.id, a.id]);
    expect(body[1]).toEqual({
      id: a.id,
      productId: p.id,
      size: 'S',
      color: { name: 'Black', hex: '#111111' },
      sku: 'NO-CHI-S-BLACK',
      barcode: '6220000000017',
      sellPrice: 1000,
      quantity: 3,
      lowStockThreshold: 3,
      isActive: true,
      product: { id: p.id, name: 'Chino Slim', baseSku: 'NO-CHI', images: ['https://img.example/a.webp'], brandName: 'Northline', tint: '#111111' },
    });
    expectNoSellerKeys(body);
  });

  it('validates the id list: missing, non-uuid, more than 200, unknown keys → 400', async () => {
    const { a, cookie } = await fixture();
    expect((await labels(cookie, '')).status).toBe(400);
    expect((await labels(cookie, '?variantIds=not-a-uuid')).status).toBe(400);
    const many = Array.from({ length: 201 }, () => randomUUID()).join(',');
    expect((await labels(cookie, `?variantIds=${many}`)).status).toBe(400);
    const ok200 = [...Array.from({ length: 199 }, () => randomUUID() as string), a.id].join(',');
    expect((await labels(cookie, `?variantIds=${ok200}`)).status).toBe(200);
    const extra = await labels(cookie, `?variantIds=${a.id}&copies=2`);
    expect(extra.status).toBe(400);
    expect((await extra.json()).error.fields.copies).toBe('Unknown field');
  });

  it('is forbidden for SELLER', async () => {
    const { a, cookie } = await fixture('SELLER');
    expect((await labels(cookie, `?variantIds=${a.id}`)).status).toBe(403);
  });
});
