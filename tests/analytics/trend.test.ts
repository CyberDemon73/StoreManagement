import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/analytics/sales-trend/route';
import { resolveRange } from '@/analytics/range';
import { trend } from '@/analytics/trend';
import { getDb } from '@/db/client';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

const zero = (bucket: string) => ({ bucket, revenue: 0, profit: 0, cogs: 0, count: 0 });

describe('trend', () => {
  it('day buckets in the store timezone; returns net in the bucket they were created in', async () => {
    const db = getDb();
    await analyticsFixture(db);
    const pts = await trend(db, await resolveRange(db, EXPECTED.range), 'day');
    expect(pts).toEqual([EXPECTED.day10, EXPECTED.day11]);
  });

  it('zero-fills empty days', async () => {
    const db = getDb();
    await analyticsFixture(db);
    const pts = await trend(db, await resolveRange(db, { from: '2026-06-09', to: '2026-06-12' }), 'day');
    expect(pts).toEqual([zero('2026-06-09'), EXPECTED.day10, EXPECTED.day11, zero('2026-06-12')]);
  });

  it('month buckets start on the first day', async () => {
    const db = getDb();
    await analyticsFixture(db);
    const pts = await trend(db, await resolveRange(db, { from: '2026-06-01', to: '2026-06-30' }), 'month');
    expect(pts).toEqual([{ bucket: '2026-06-01', revenue: EXPECTED.revenue, cogs: EXPECTED.cogs, profit: EXPECTED.profit, count: EXPECTED.salesCount }]);
  });

  it('week buckets start on Monday (2026-06-08)', async () => {
    const db = getDb();
    await analyticsFixture(db);
    const pts = await trend(db, await resolveRange(db, { from: '2026-06-10', to: '2026-06-16' }), 'week');
    expect(pts).toEqual([
      { bucket: '2026-06-08', revenue: EXPECTED.revenue, cogs: EXPECTED.cogs, profit: EXPECTED.profit, count: EXPECTED.salesCount },
      zero('2026-06-15'),
    ]);
  });
});

describe('GET /analytics/sales-trend', () => {
  it('manager gets 200 (interval defaults to day) with the cache header', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.manager.id);
    const res = await call(GET, { path: '/api/v1/analytics/sales-trend?from=2026-06-10&to=2026-06-11', cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    expect(await res.json()).toEqual([EXPECTED.day10, EXPECTED.day11]);
  });

  it('rejects unknown intervals and keys with 400', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.manager.id);
    const bad = await call(GET, { path: '/api/v1/analytics/sales-trend?from=2026-06-10&to=2026-06-11&interval=year', cookie });
    expect(bad.status).toBe(400);
    const extra = await call(GET, { path: '/api/v1/analytics/sales-trend?from=2026-06-10&to=2026-06-11&x=1', cookie });
    expect(extra.status).toBe(400);
    const reversed = await call(GET, { path: '/api/v1/analytics/sales-trend?from=2026-06-11&to=2026-06-10', cookie });
    expect(reversed.status).toBe(400);
  });

  it('SELLER gets 403', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.sellerB.id);
    const res = await call(GET, { path: '/api/v1/analytics/sales-trend?from=2026-06-10&to=2026-06-11', cookie });
    expect(res.status).toBe(403);
  });
});
