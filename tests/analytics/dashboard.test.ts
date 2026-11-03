import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dashboard } from '@/analytics/dashboard';
import { resolveRange } from '@/analytics/range';
import { getDb } from '@/db/client';
import { variants } from '@/db/schema';
import { applyMovement } from '@/services/stock';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';

describe('dashboard', () => {
  it('assembles kpis, day trend, brand split, top products, low stock and recent sales', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    await db.update(variants).set({ lowStockThreshold: 10 }).where(eq(variants.id, fx.c1.id));
    const d = await dashboard(db, await resolveRange(db, EXPECTED.range));

    expect(d.kpis.totalCash).toBe(EXPECTED.revenue);
    expect(d.trend).toEqual([EXPECTED.day10, EXPECTED.day11]);

    // Northline: 2000 + 2000×2800/3000 = 3866.67; Casa: 1000×2800/3000 + 500 − 466.67 = 966.33.
    expect(d.brandSplit).toEqual([
      { id: fx.brandN.id, name: 'Northline', revenue: 3867, sharePct: 80 },
      { id: fx.brandC.id, name: 'Casa', revenue: 966, sharePct: 20 },
    ]);
    expect(d.brandSplit.reduce((a, b) => a + b.revenue, 0)).toBe(EXPECTED.revenue);

    expect(d.topProducts).toEqual([
      { productId: fx.productPN.id, name: 'North Shirt', brand: 'Northline', units: 3, revenue: 3867, profit: 2067, marginPct: 53.4 },
      { productId: fx.productPC.id, name: 'Casa Tee', brand: 'Casa', units: 2, revenue: 966, profit: 566, marginPct: 58.6 },
    ]);

    expect(d.lowStock.map((v) => v.id)).toEqual([fx.c1.id]);
    expect(d.recentSales.map((s) => s.id)).toEqual([fx.saleIds.s4, fx.saleIds.s3, fx.saleIds.s2, fx.saleIds.s1]);
    // Recent sales go through the standard sale serializer (items hydrated).
    expect(d.recentSales[2]!.items).toHaveLength(2);
  });

  it('lists out-of-stock before low and caps at 6', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    await db.update(variants).set({ lowStockThreshold: 100 });
    // n2 has 9 left: adjust it to zero so it is "out".
    await db.transaction((tx) => applyMovement(tx, { variantId: fx.n2.id, type: 'ADJUSTMENT', qtyDelta: -9, reason: 'test', userId: fx.manager.id }));
    const d = await dashboard(db, await resolveRange(db, EXPECTED.range));
    expect(d.lowStock.map((v) => v.id)[0]).toBe(fx.n2.id);
    expect(d.lowStock).toHaveLength(3);
    expect(d.kpis).toMatchObject({ lowStockCount: 2, outOfStockCount: 1, skusInStock: 2, unitsInStock: 26 });
  });
});
