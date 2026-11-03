import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { can } from '@/lib/permissions';
import { ROUTES } from '@/lib/route-manifest';
import { createProductDirect, createVariantDirect, expectNoSellerKeys, seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

/**
 * docs/ACCESS-MATRIX.md: every endpoint a SELLER can read must never contain cost/profit keys.
 * Iterates the manifest so a new seller-readable GET route is covered automatically.
 */
describe('seller stripping across every seller-readable GET route', () => {
  const sellerGets = ROUTES.filter((r) => r.method === 'GET' && r.access !== 'public' && (r.access === 'auth' || can({ role: 'SELLER' }, r.access)));

  it('has seller-readable routes to check', () => {
    expect(sellerGets.length).toBeGreaterThan(5);
  });

  for (const route of sellerGets) {
    it(`GET ${route.path} → no cost keys for SELLER`, async () => {
      const db = getDb();
      const { brand, category } = await seedCatalog(db);
      const product = await createProductDirect(db, { name: 'Chino Slim', baseSku: 'NO-CHI', brandId: brand.id, categoryId: category.id, defaultPrice: 1000, defaultCost: 600 });
      const variant = await createVariantDirect(db, { productId: product.id, size: 'S', colorName: 'Black', sku: 'NO-CHI-S-BLACK', barcode: '6220000000017', sellPrice: 1000, costPrice: 600, quantity: 3 });
      const seller = await createUser(db, { role: 'SELLER' });
      const cookie = await sessionCookieFor(db, seller.id);
      const handlers = await route.load();
      const handler = handlers.GET;
      if (!handler) throw new Error(`no GET for ${route.path}`);
      const params: Record<string, string> = route.path.includes(':id') ? { id: route.path.startsWith('/variants') ? variant.id : product.id } : {};
      const query = route.path === '/variants/lookup' ? '?sku=NO-CHI-S-BLACK' : route.path === '/variants/search' ? '?q=chino' : '';
      const res = await call(handler, { path: `/api/v1${route.path.replace(':id', params['id'] ?? '')}${query}`, cookie, params });
      expect(res.status, `${route.path} status`).toBeLessThan(500);
      if (res.status === 200) expectNoSellerKeys(await res.json());
    });
  }
});
