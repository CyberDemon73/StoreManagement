import { describe, expect, it } from 'vitest';
import { GET as getTopProducts } from '@/app/api/v1/analytics/top-products/route';
import { GET as getTopVariants } from '@/app/api/v1/analytics/top-variants/route';
import { getDb } from '@/db/client';
import { resolveRange } from '@/analytics/range';
import { topProducts, topVariants } from '@/analytics/top-products';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

const RANGE = `from=${EXPECTED.range.from}&to=${EXPECTED.range.to}`;

describe('top products', () => {
  it('ranks by units net of returns; the VOID sale contributes nothing', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const r = await resolveRange(db, EXPECTED.range);
    const rows = await topProducts(db, r, { by: 'units', limit: 10 });
    expect(rows).toEqual([
      { productId: fx.productPN.id, name: 'North Shirt', brand: 'Northline', units: 3, revenue: 3867, profit: 2067, marginPct: 53.4 },
      { productId: fx.productPC.id, name: 'Casa Tee', brand: 'Casa', units: 2, revenue: 966, profit: 566, marginPct: 58.6 },
    ]);
    expect((await topProducts(db, r, { by: 'profit', limit: 1 })).map((p) => p.name)).toEqual(['North Shirt']);
  });

  it('top variants add variant id, size, colour and sku; ties break by product name', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const rows = await topVariants(db, await resolveRange(db, EXPECTED.range), { by: 'units', limit: 10 });
    expect(rows.map((v) => [v.sku, v.units])).toEqual([
      ['CA-TEE-S-WHITE', 2],
      ['NO-SHI-S-BLACK', 2],
      ['NO-SHI-M-BLACK', 1],
    ]);
    expect(rows[1]).toMatchObject({
      variantId: fx.n1.id,
      productId: fx.productPN.id,
      name: 'North Shirt',
      brand: 'Northline',
      size: 'S',
      color: { name: 'Black', hex: '#111111' },
      revenue: 2000,
      profit: 1200,
      marginPct: 60,
    });
  });

  it('routes: manager 200 + cache header, seller 403, limit=51 → 400', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const manager = await sessionCookieFor(db, fx.manager.id);
    const ok = await call(getTopProducts, { path: `/api/v1/analytics/top-products?${RANGE}&by=revenue&limit=1`, cookie: manager });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect((await ok.json()).map((p: { name: string }) => p.name)).toEqual(['North Shirt']);

    const variantsOk = await call(getTopVariants, { path: `/api/v1/analytics/top-variants?${RANGE}`, cookie: manager });
    expect(variantsOk.status).toBe(200);
    expect(variantsOk.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect((await variantsOk.json())[0]).toHaveProperty('sku');

    const seller = await sessionCookieFor(db, fx.sellerA.id);
    expect((await call(getTopProducts, { path: `/api/v1/analytics/top-products?${RANGE}`, cookie: seller })).status).toBe(403);
    expect((await call(getTopVariants, { path: `/api/v1/analytics/top-variants?${RANGE}`, cookie: seller })).status).toBe(403);
    expect((await call(getTopProducts, { path: `/api/v1/analytics/top-products?${RANGE}&limit=51`, cookie: manager })).status).toBe(400);
    expect((await call(getTopVariants, { path: `/api/v1/analytics/top-variants?${RANGE}&by=margin`, cookie: manager })).status).toBe(400);
  });
});
