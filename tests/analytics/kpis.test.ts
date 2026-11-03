import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/analytics/dashboard/route';
import { brands } from '@/analytics/brands';
import { categories } from '@/analytics/categories';
import { deltaPct, kpis } from '@/analytics/kpis';
import { resolveRange } from '@/analytics/range';
import { topProducts } from '@/analytics/top-products';
import { getDb } from '@/db/client';
import { returns, variants } from '@/db/schema';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

describe('kpis', () => {
  it('marginPct is 0 when revenue is not positive (a range holding only a restocked return)', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    await db.update(returns).set({ createdAt: new Date('2026-06-13T12:00:00Z') }).where(eq(returns.id, fx.returnId));
    const r = await resolveRange(db, { from: '2026-06-13', to: '2026-06-13' });
    // revenue −467, cogs −200 → profit −267: a loss, not a 57% margin.
    expect(await kpis(db, r)).toMatchObject({ totalCash: -467, grossProfit: -267, marginPct: 0 });
    expect((await brands(db, r)).find((b) => b.id === fx.brandC.id)).toMatchObject({ revenue: -467, profit: -267, marginPct: 0 });
    expect((await categories(db, r)).find((c) => c.id === fx.categoryT.id)).toMatchObject({ revenue: -467, marginPct: 0 });
    expect(await topProducts(db, r, { by: 'units', limit: 10 })).toEqual([
      expect.objectContaining({ productId: fx.productPC.id, revenue: -467, profit: -267, marginPct: 0 }),
    ]);
  });

  it('deltaPct from a zero previous period keeps the sign of the current value', () => {
    expect(deltaPct(-1000, 0)).toBe(-100);
    expect(deltaPct(1000, 0)).toBe(100);
    expect(deltaPct(0, 0)).toBe(0);
  });

  it('computes cash, profit, counts and basket from the shared facts (VOID excluded, refunds netted)', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    // c1 ends with 8 units: a threshold of 10 makes it "low" for the low-stock count.
    await db.update(variants).set({ lowStockThreshold: 10 }).where(eq(variants.id, fx.c1.id));
    const k = await kpis(db, await resolveRange(db, EXPECTED.range));
    expect(k).toEqual({
      totalCash: EXPECTED.revenue,
      cashByMethod: EXPECTED.cashByMethod,
      grossProfit: EXPECTED.profit,
      marginPct: EXPECTED.marginPct,
      cogs: EXPECTED.cogs,
      // Stock after the fixture: N1 20−2−1+1(void) = 18, N2 10−1 = 9, C1 10−2−1+1(return) = 8.
      unitsInStock: 35,
      skusInStock: 3,
      stockValueCost: 18 * 400 + 9 * 1000 + 8 * 200,
      stockValueRetail: 18 * 1000 + 9 * 2000 + 8 * 500,
      salesCount: EXPECTED.salesCount,
      avgBasket: EXPECTED.avgBasket,
      lowStockCount: 1,
      outOfStockCount: 0,
      // Previous period 06-08..06-09 is empty → 100 for every non-zero metric.
      deltas: { totalCash: 100, grossProfit: 100, salesCount: 100, avgBasket: 100 },
    });
  });

  it('deltas compare against the previous period of the same length', async () => {
    const db = getDb();
    await analyticsFixture(db);
    // 06-11 vs 06-10: cash 33 vs 4800, count 1 vs 2, basket 500 vs 2400, profit 33 vs 2600.
    const k = await kpis(db, await resolveRange(db, { from: '2026-06-11', to: '2026-06-11' }));
    expect(k.deltas).toEqual({ totalCash: -99.3, grossProfit: -98.7, salesCount: -50, avgBasket: -79.2 });
    // An empty period after an empty period is 0, not NaN.
    const empty = await kpis(db, await resolveRange(db, { from: '2026-01-01', to: '2026-01-01' }));
    expect(empty).toMatchObject({ totalCash: 0, marginPct: 0, salesCount: 0, avgBasket: 0 });
    expect(empty.deltas).toEqual({ totalCash: 0, grossProfit: 0, salesCount: 0, avgBasket: 0 });
  });
});

describe('GET /analytics/dashboard', () => {
  it('manager gets 200 with a private no-store header', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.manager.id);
    const res = await call(GET, { path: '/api/v1/analytics/dashboard?from=2026-06-10&to=2026-06-11', cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.kpis.totalCash).toBe(EXPECTED.revenue);
  });

  it('SELLER gets 403', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.sellerA.id);
    const res = await call(GET, { path: '/api/v1/analytics/dashboard?from=2026-06-10&to=2026-06-11', cookie });
    expect(res.status).toBe(403);
  });

  it('from after to is a 400', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.manager.id);
    const res = await call(GET, { path: '/api/v1/analytics/dashboard?from=2026-06-11&to=2026-06-10', cookie });
    expect(res.status).toBe(400);
  });
});
