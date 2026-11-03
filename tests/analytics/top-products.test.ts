import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as getTopProducts } from '@/app/api/v1/analytics/top-products/route';
import { GET as getTopVariants } from '@/app/api/v1/analytics/top-variants/route';
import { getDb } from '@/db/client';
import { products, sales, variants } from '@/db/schema';
import { brands } from '@/analytics/brands';
import { resolveRange } from '@/analytics/range';
import { topProducts, topVariants } from '@/analytics/top-products';
import { createSale } from '@/services/sales';
import { applyMovement } from '@/services/stock';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { authUserOf } from '../helpers/sales';
import { sessionCookieFor } from '../helpers/users';

const CTX = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'test' };

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

  it('a zero-subtotal sale counts revenue 0 and its cost as a loss (no nulls)', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const [gift] = await db
      .insert(products)
      .values({ name: 'Free Gift', baseSku: 'FR-GIF', brandId: fx.brandN.id, categoryId: fx.categoryT.id, defaultPrice: 300 })
      .returning();
    const [v] = await db
      .insert(variants)
      .values({ productId: gift!.id, size: 'OS', colorName: 'Red', colorHex: '#FF0000', sku: 'FR-GIF-OS-RED', sellPrice: 300 })
      .returning();
    await db.transaction((tx) => applyMovement(tx, { variantId: v!.id, type: 'INITIAL', qtyDelta: 5, unitCost: 250, userId: fx.manager.id }));
    const sale = await createSale(db, authUserOf(fx.manager, 'Mona'), { items: [{ variantId: v!.id, qty: 1, unitPrice: 0 }], paymentMethod: 'CASH' }, CTX);
    await db.update(sales).set({ createdAt: new Date('2026-06-10T10:00:00Z') }).where(eq(sales.id, sale.id));
    const r = await resolveRange(db, EXPECTED.range);

    const byProfit = await topProducts(db, r, { by: 'profit', limit: 10 });
    expect(byProfit.map((p) => p.name)).toEqual(['North Shirt', 'Casa Tee', 'Free Gift']);
    expect(byProfit[2]).toEqual({ productId: gift!.id, name: 'Free Gift', brand: 'Northline', units: 1, revenue: 0, profit: -250, marginPct: 0 });

    const bs = await brands(db, r);
    for (const row of [...byProfit, ...bs]) for (const value of Object.values(row)) expect(value).not.toBeNull();
    expect(bs.find((b) => b.id === fx.brandN.id)).toMatchObject({ revenue: 3867, profit: 1817 });
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
    expect(ok.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await ok.json()).map((p: { name: string }) => p.name)).toEqual(['North Shirt']);

    const variantsOk = await call(getTopVariants, { path: `/api/v1/analytics/top-variants?${RANGE}`, cookie: manager });
    expect(variantsOk.status).toBe(200);
    expect(variantsOk.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await variantsOk.json())[0]).toHaveProperty('sku');

    const seller = await sessionCookieFor(db, fx.sellerA.id);
    expect((await call(getTopProducts, { path: `/api/v1/analytics/top-products?${RANGE}`, cookie: seller })).status).toBe(403);
    expect((await call(getTopVariants, { path: `/api/v1/analytics/top-variants?${RANGE}`, cookie: seller })).status).toBe(403);
    expect((await call(getTopProducts, { path: `/api/v1/analytics/top-products?${RANGE}&limit=51`, cookie: manager })).status).toBe(400);
    expect((await call(getTopVariants, { path: `/api/v1/analytics/top-variants?${RANGE}&by=margin`, cookie: manager })).status).toBe(400);
  });
});
