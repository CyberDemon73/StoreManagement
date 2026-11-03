import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/analytics/payment-mix/route';
import { paymentMix } from '@/analytics/payment-mix';
import { resolveRange } from '@/analytics/range';
import { getDb } from '@/db/client';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

const MIX = [
  { method: 'CASH', count: 2, total: EXPECTED.cashByMethod.CASH },
  { method: 'CARD', count: 1, total: EXPECTED.cashByMethod.CARD },
  { method: 'WALLET', count: 0, total: 0 },
  { method: 'TRANSFER', count: 0, total: 0 },
];

describe('paymentMix', () => {
  it('always four rows; sales by method minus refunds by refund method; VOID excluded', async () => {
    const db = getDb();
    await analyticsFixture(db);
    expect(await paymentMix(db, await resolveRange(db, EXPECTED.range))).toEqual(MIX);
  });

  it('an empty range still has four zero rows', async () => {
    const db = getDb();
    const rows = await paymentMix(db, await resolveRange(db, { from: '2026-01-01', to: '2026-01-31' }));
    expect(rows).toEqual(['CASH', 'CARD', 'WALLET', 'TRANSFER'].map((method) => ({ method, count: 0, total: 0 })));
  });
});

describe('GET /analytics/payment-mix', () => {
  it('manager gets 200 with the cache header', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.manager.id);
    const res = await call(GET, { path: '/api/v1/analytics/payment-mix?from=2026-06-10&to=2026-06-11', cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual(MIX);
  });

  it('SELLER gets 403; from after to is 400', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const seller = await sessionCookieFor(db, fx.sellerA.id);
    expect((await call(GET, { path: '/api/v1/analytics/payment-mix?from=2026-06-10&to=2026-06-11', cookie: seller })).status).toBe(403);
    const manager = await sessionCookieFor(db, fx.manager.id);
    expect((await call(GET, { path: '/api/v1/analytics/payment-mix?from=2026-06-11&to=2026-06-10', cookie: manager })).status).toBe(400);
  });
});
