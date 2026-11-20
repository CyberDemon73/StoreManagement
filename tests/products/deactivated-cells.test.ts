import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/products/[id]/route';
import { POST as ADD_VARIANTS } from '@/app/api/v1/products/[id]/variants/route';
import { POST as CREATE } from '@/app/api/v1/products/route';
import { PATCH as PATCH_VARIANT } from '@/app/api/v1/variants/[id]/route';
import { getDb } from '@/db/client';
import { createUser, sessionCookieFor } from '../helpers/users';
import { seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';

const BLACK = { name: 'Black', hex: '#000000' };

async function fixture() {
  const db = getDb();
  const cat = await seedCatalog(db);
  const manager = await createUser(db, { role: 'MANAGER' });
  const cookie = await sessionCookieFor(db, manager.id);
  const res = await call(CREATE, {
    method: 'POST',
    path: '/api/v1/products',
    cookie,
    body: {
      name: 'Tee',
      brandId: cat.brand.id,
      categoryId: cat.category.id,
      defaultPrice: 1000,
      defaultCost: 600,
      variants: { sizes: ['S', 'M'], colors: [BLACK], initialQty: 0 },
    },
  });
  expect(res.status).toBe(201);
  const product = await res.json();
  const variants: { id: string; size: string }[] = product.variants;
  return { cookie, product, variantOf: (size: string) => variants.find((v) => v.size === size)! };
}

async function detail(cookie: string, id: string) {
  const res = await call(GET, { path: `/api/v1/products/${id}`, cookie, params: { id } });
  expect(res.status).toBe(200);
  return res.json();
}

async function setActive(cookie: string, id: string, isActive: boolean) {
  const res = await call(PATCH_VARIANT, { method: 'PATCH', path: `/api/v1/variants/${id}`, cookie, params: { id }, body: { isActive } });
  expect(res.status).toBe(200);
}

describe('deactivated variants on the product detail', () => {
  it('drops a size from sizes once all its cells are deactivated, and brings it back on reactivation', async () => {
    const { cookie, product, variantOf } = await fixture();
    expect((await detail(cookie, product.id)).sizes).toEqual(['S', 'M']);

    await setActive(cookie, variantOf('M').id, false);
    expect((await detail(cookie, product.id)).sizes).toEqual(['S']);

    await setActive(cookie, variantOf('M').id, true);
    expect((await detail(cookie, product.id)).sizes).toEqual(['S', 'M']);
  });

  it('keeps a deactivated colour out of colors while other colours remain', async () => {
    const { cookie, product } = await fixture();
    const add = await call(ADD_VARIANTS, { method: 'POST', path: `/api/v1/products/${product.id}/variants`, cookie, params: { id: product.id }, body: { sizes: ['S'], colors: [{ name: 'White', hex: '#FFFFFF' }] } });
    expect(add.status).toBe(201);
    const d = await detail(cookie, product.id);
    const white = d.variants.find((v: { color: { name: string } }) => v.color.name === 'White');
    await setActive(cookie, white.id, false);
    expect((await detail(cookie, product.id)).colors.map((c: { name: string }) => c.name)).toEqual(['Black']);
  });
});
