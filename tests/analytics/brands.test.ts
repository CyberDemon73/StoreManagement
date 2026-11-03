import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/analytics/brands/route';
import { getDb } from '@/db/client';
import { brands as brandsTable, categories as categoriesTable, variants } from '@/db/schema';
import { categories } from '@/analytics/categories';
import { dashboard } from '@/analytics/dashboard';
import { brandSplit, brands } from '@/analytics/brands';
import { resolveRange } from '@/analytics/range';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

const PATH = `/api/v1/analytics/brands?from=${EXPECTED.range.from}&to=${EXPECTED.range.to}`;

describe('brands report', () => {
  it('splits revenue net of discount and refunds per brand; sums to the dashboard revenue', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    await db.insert(brandsTable).values({ name: 'Zeta' });
    const rows = await brands(db, await resolveRange(db, EXPECTED.range));

    expect(rows.map((b) => b.name)).toEqual(['Northline', 'Casa', 'Zeta']);
    const [n, c, z] = rows;
    // Northline: S1 2000 + N2 line 2000 × 2800/3000; Casa: C1 lines 1000 × 2800/3000 + S3 500 − refund 467
    expect(n).toMatchObject({ id: fx.brandN.id, revenue: 3867, unitsSold: 3, profit: 2067, marginPct: 53.4, sharePct: 80 });
    expect(c).toMatchObject({ id: fx.brandC.id, revenue: 966, unitsSold: 2, profit: 566, marginPct: 58.6, sharePct: 20 });
    expect(n!.revenue + c!.revenue).toBe(EXPECTED.revenue);
    expect(z).toEqual(expect.objectContaining({ unitsInStock: 0, stockValueCost: 0, stockValueRetail: 0, unitsSold: 0, revenue: 0, profit: 0, marginPct: 0, sharePct: 0 }));

    const vs = await db.select().from(variants).where(inArray(variants.id, [fx.n1.id, fx.n2.id]));
    expect(n).toMatchObject({
      unitsInStock: vs.reduce((a, v) => a + Math.max(0, v.quantity), 0),
      stockValueCost: vs.reduce((a, v) => a + Math.max(0, v.quantity) * (v.costPrice ?? 0), 0),
      stockValueRetail: vs.reduce((a, v) => a + Math.max(0, v.quantity) * v.sellPrice, 0),
    });
  });

  it('retired brands and categories with activity in range still reconcile with total revenue', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    await db.update(brandsTable).set({ isActive: false }).where(eq(brandsTable.id, fx.brandC.id));
    await db.update(categoriesTable).set({ isActive: false }).where(eq(categoriesTable.id, fx.categoryT.id));
    await db.insert(brandsTable).values({ name: 'Retired', isActive: false });
    const r = await resolveRange(db, EXPECTED.range);

    const bs = await brands(db, r);
    expect(bs.map((b) => b.name)).toEqual(['Northline', 'Casa']);
    expect(bs.reduce((a, b) => a + b.revenue, 0)).toBe(EXPECTED.revenue);
    expect(bs.reduce((a, b) => a + b.sharePct, 0)).toBe(100);
    const cs = await categories(db, r);
    expect(cs.map((c) => c.name)).toEqual(['Tops']);
    expect(cs.reduce((a, c) => a + c.revenue, 0)).toBe(EXPECTED.revenue);

    const d = await dashboard(db, r);
    expect(d.brandSplit).toEqual(bs.map(({ id, name, revenue, sharePct }) => ({ id, name, revenue, sharePct })));
  });

  it('brandSplit gives id, name, revenue and share only', async () => {
    const db = getDb();
    await analyticsFixture(db);
    const split = await brandSplit(db, await resolveRange(db, EXPECTED.range));
    expect(split).toEqual([
      { id: expect.any(String), name: 'Northline', revenue: 3867, sharePct: 80 },
      { id: expect.any(String), name: 'Casa', revenue: 966, sharePct: 20 },
    ]);
  });

  it('GET /analytics/brands: manager 200 with private cache header, seller 403', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const ok = await call(GET, { path: PATH, cookie: await sessionCookieFor(db, fx.manager.id) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await ok.json())[0]).toMatchObject({ name: 'Northline', revenue: 3867 });
    const denied = await call(GET, { path: PATH, cookie: await sessionCookieFor(db, fx.sellerA.id) });
    expect(denied.status).toBe(403);
  });
});
