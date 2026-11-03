import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/analytics/returns/route';
import { getDb } from '@/db/client';
import { resolveRange } from '@/analytics/range';
import { returnsReport } from '@/analytics/returns';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

const QS = `from=${EXPECTED.range.from}&to=${EXPECTED.range.to}`;

describe('returns report', () => {
  it('counts returns in range against non-VOID sales in range', async () => {
    const db = getDb();
    await analyticsFixture(db);
    const report = await returnsReport(db, await resolveRange(db, EXPECTED.range));
    expect(report).toEqual({ count: 1, value: 467, ratePct: 33.3, byReason: [{ reason: 'Too small', count: 1, value: 467 }] });
  });

  it('is zero (not NaN) for a range without sales', async () => {
    const db = getDb();
    await analyticsFixture(db);
    const report = await returnsReport(db, await resolveRange(db, { from: '2026-01-01', to: '2026-01-31' }));
    expect(report).toEqual({ count: 0, value: 0, ratePct: 0, byReason: [] });
  });

  it('GET: manager 200 with private cache, SELLER 403, bad date 400', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const manager = await sessionCookieFor(db, fx.manager.id);
    const ok = await call(GET, { path: `/api/v1/analytics/returns?${QS}`, cookie: manager });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect((await ok.json()).count).toBe(1);

    const seller = await sessionCookieFor(db, fx.sellerB.id);
    expect((await call(GET, { path: `/api/v1/analytics/returns?${QS}`, cookie: seller })).status).toBe(403);
    expect((await call(GET, { path: '/api/v1/analytics/returns?from=2026-02-30&to=2026-03-01', cookie: manager })).status).toBe(400);
  });
});
