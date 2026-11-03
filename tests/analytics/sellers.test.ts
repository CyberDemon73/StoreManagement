import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/analytics/sellers/route';
import { getDb } from '@/db/client';
import { resolveRange } from '@/analytics/range';
import { sellers } from '@/analytics/sellers';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

const QS = `from=${EXPECTED.range.from}&to=${EXPECTED.range.to}`;

describe('sellers report', () => {
  it('attributes revenue, baskets, discounts and returns to the seller of each sale (VOID excluded)', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const rows = await sellers(db, await resolveRange(db, EXPECTED.range));
    expect(rows).toEqual([
      {
        userId: fx.sellerA.id,
        name: 'Amira',
        salesCount: 2,
        revenue: 2500,
        avgBasket: 1250,
        discountGiven: 0,
        discountPct: 0,
        returnsCount: 0,
        returnsValue: 0,
        returnRatePct: 0,
      },
      {
        userId: fx.sellerB.id,
        name: 'Bassem',
        salesCount: 1,
        revenue: 2333,
        avgBasket: 2800,
        discountGiven: 200,
        discountPct: 6.7,
        returnsCount: 1,
        returnsValue: 467,
        returnRatePct: 100,
      },
    ]);
  });

  it('GET: manager 200 with private cache, SELLER 403, missing range 400', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const manager = await sessionCookieFor(db, fx.manager.id);
    const ok = await call(GET, { path: `/api/v1/analytics/sellers?${QS}`, cookie: manager });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect((await ok.json()).map((s: { name: string }) => s.name)).toEqual(['Amira', 'Bassem']);

    const seller = await sessionCookieFor(db, fx.sellerA.id);
    expect((await call(GET, { path: `/api/v1/analytics/sellers?${QS}`, cookie: seller })).status).toBe(403);
    expect((await call(GET, { path: '/api/v1/analytics/sellers', cookie: manager })).status).toBe(400);
    expect((await call(GET, { path: `/api/v1/analytics/sellers?${QS}&x=1`, cookie: manager })).status).toBe(400);
  });
});
