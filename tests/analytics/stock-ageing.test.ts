import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/analytics/stock-ageing/route';
import { getDb } from '@/db/client';
import { stockMovements, variants } from '@/db/schema';
import { brands } from '@/analytics/brands';
import { stockOnHand } from '@/analytics/facts';
import { resolveRange } from '@/analytics/range';
import { stockAgeing } from '@/analytics/stock-ageing';
import { applyMovement } from '@/services/stock';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

describe('stock ageing', () => {
  it('returns the four buckets in order and their units sum to stock on hand', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    // N2 was last received 75 days ago → 61-90.
    await db
      .update(stockMovements)
      .set({ createdAt: sql`now() - interval '75 days'` })
      .where(eq(stockMovements.variantId, fx.n2.id));
    const rows = await stockAgeing(db);
    expect(rows.map((r) => r.bucket)).toEqual(['0-30', '31-60', '61-90', '90+']);

    const res = (await db.execute(sql`with soh as (${stockOnHand()}) select coalesce(sum(qty), 0)::int as units from soh`)) as {
      rows: { units: number }[];
    };
    expect(rows.reduce((a, r) => a + r.units, 0)).toBe(res.rows[0]!.units);
    // N1 20−2−1+1(void) = 18 @400 + C1 10−2−1+1(restock) = 8 @200 recent; N2 9 @1000 old.
    expect(rows).toEqual([
      { bucket: '0-30', units: 26, valueCost: 8800 },
      { bucket: '31-60', units: 0, valueCost: 0 },
      { bucket: '61-90', units: 9, valueCost: 9000 },
      { bucket: '90+', units: 0, valueCost: 0 },
    ]);
  });

  it('values beyond int4 do not overflow (2e9 cost × 2 units)', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    await db.transaction((tx) => applyMovement(tx, { variantId: fx.n2.id, type: 'ADJUSTMENT', qtyDelta: -7, reason: 'test', userId: fx.manager.id }));
    await db.update(variants).set({ costPrice: 2_000_000_000 }).where(eq(variants.id, fx.n2.id));
    await db
      .update(stockMovements)
      .set({ createdAt: sql`now() - interval '75 days'` })
      .where(eq(stockMovements.variantId, fx.n2.id));
    const res = await call(GET, { path: '/api/v1/analytics/stock-ageing', cookie: await sessionCookieFor(db, fx.manager.id) });
    expect(res.status).toBe(200);
    expect((await res.json())[2]).toEqual({ bucket: '61-90', units: 2, valueCost: 4_000_000_000 });
    const b = await brands(db, await resolveRange(db, EXPECTED.range));
    expect(b.find((x) => x.id === fx.brandN.id)!.stockValueCost).toBe(18 * 400 + 4_000_000_000);
  });

  it('GET: manager 200 with private cache, SELLER 403, unknown key 400', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const manager = await sessionCookieFor(db, fx.manager.id);
    const ok = await call(GET, { path: '/api/v1/analytics/stock-ageing', cookie: manager });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await ok.json()).toHaveLength(4);
    const seller = await sessionCookieFor(db, fx.sellerA.id);
    expect((await call(GET, { path: '/api/v1/analytics/stock-ageing', cookie: seller })).status).toBe(403);
    expect((await call(GET, { path: '/api/v1/analytics/stock-ageing?days=3', cookie: manager })).status).toBe(400);
  });
});
