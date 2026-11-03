import { inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/analytics/categories/route';
import { getDb } from '@/db/client';
import { categories as categoriesTable, variants } from '@/db/schema';
import { categories } from '@/analytics/categories';
import { resolveRange } from '@/analytics/range';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

const PATH = `/api/v1/analytics/categories?from=${EXPECTED.range.from}&to=${EXPECTED.range.to}`;

describe('categories report', () => {
  it('gives CategoryStats for active categories with days of cover', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    await db.insert(categoriesTable).values({ name: 'Empty' });
    await db.insert(categoriesTable).values({ name: 'Hidden', isActive: false });
    const rows = await categories(db, await resolveRange(db, EXPECTED.range));

    expect(rows.map((c) => c.name)).toEqual(['Tops', 'Empty']);
    const vs = await db.select().from(variants).where(inArray(variants.id, [fx.n1.id, fx.n2.id, fx.c1.id]));
    const unitsInStock = vs.reduce((a, v) => a + Math.max(0, v.quantity), 0);
    expect(rows[0]).toEqual({
      id: fx.categoryT.id,
      name: 'Tops',
      unitsInStock,
      unitsSold: EXPECTED.unitsSold,
      stockValueCost: vs.reduce((a, v) => a + Math.max(0, v.quantity) * (v.costPrice ?? 0), 0),
      stockValueRetail: vs.reduce((a, v) => a + Math.max(0, v.quantity) * v.sellPrice, 0),
      revenue: EXPECTED.revenue,
      profit: EXPECTED.profit,
      marginPct: EXPECTED.marginPct,
      daysOfCover: Math.round(unitsInStock / (EXPECTED.unitsSold / 2)),
    });
    expect(rows[1]).toMatchObject({ unitsSold: 0, revenue: 0, profit: 0, marginPct: 0, daysOfCover: 999 });
  });

  it('GET /analytics/categories: manager 200 with private cache header, seller 403', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const ok = await call(GET, { path: PATH, cookie: await sessionCookieFor(db, fx.manager.id) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await ok.json())[0]).toMatchObject({ name: 'Tops', revenue: EXPECTED.revenue });
    const denied = await call(GET, { path: PATH, cookie: await sessionCookieFor(db, fx.sellerA.id) });
    expect(denied.status).toBe(403);
  });
});
