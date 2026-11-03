import { afterEach, describe, expect, it } from 'vitest';
import { GET as exportReport } from '@/app/api/v1/analytics/export/route';
import { GET as paymentMixRoute } from '@/app/api/v1/analytics/payment-mix/route';
import { REPORTS } from '@/analytics/registry';
import { getDb } from '@/db/client';
import { bumpAnalyticsVersion, memo, setCacheStoreForTests } from '@/lib/cache';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

afterEach(() => setCacheStoreForTests(null));

function fakeStore() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T>(k: string) => (data.has(k) ? (data.get(k) as T) : null),
    set: async (k: string, v: unknown) => {
      data.set(k, v);
    },
    incr: async (k: string) => {
      const n = ((data.get(k) as number | undefined) ?? 0) + 1;
      data.set(k, n);
      return n;
    },
  };
}

describe('GET /analytics/export', () => {
  it('streams the same numbers as the JSON report as CSV', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.manager.id);
    const res = await call(exportReport, { path: `/api/v1/analytics/export?report=payment-mix&from=${EXPECTED.range.from}&to=${EXPECTED.range.to}`, cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('payment-mix.csv');
    // Response.text() strips a UTF-8 BOM while decoding, so check the raw bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(bytes).trim().split('\r\n');
    expect(lines[0]).toBe('method,count,total');
    expect(lines.slice(1)).toEqual(['CASH,2,2500', 'CARD,1,2333', 'WALLET,0,0', 'TRANSFER,0,0']);
  });

  it('exports every registered report without error', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.manager.id);
    const range = `from=${EXPECTED.range.from}&to=${EXPECTED.range.to}`;
    const noRange = new Set(['slow-movers', 'stock-ageing', 'price-list', 'size-color']);
    expect(Object.keys(REPORTS).length).toBeGreaterThanOrEqual(13);
    for (const name of Object.keys(REPORTS)) {
      const qs = noRange.has(name) ? '' : `&${range}`;
      const res = await call(exportReport, { path: `/api/v1/analytics/export?report=${name}${qs}`, cookie });
      expect(res.status, name).toBe(200);
    }
  });

  it('rejects unknown reports, prototype keys and sellers', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.manager.id);
    expect((await call(exportReport, { path: '/api/v1/analytics/export?report=nope', cookie })).status).toBe(400);
    expect((await call(exportReport, { path: '/api/v1/analytics/export?report=constructor', cookie })).status).toBe(400);
    const seller = await sessionCookieFor(db, fx.sellerA.id);
    expect((await call(exportReport, { path: '/api/v1/analytics/export?report=payment-mix', cookie: seller })).status).toBe(403);
  });
});

describe('report caching', () => {
  it('serves the second call from cache and a version bump invalidates it', async () => {
    const store = fakeStore();
    setCacheStoreForTests(store);
    let calls = 0;
    const fn = async () => ++calls;
    expect(await memo('an:x', fn)).toBe(1);
    expect(await memo('an:x', fn)).toBe(1);
    await bumpAnalyticsVersion();
    expect(await memo('an:x', fn)).toBe(2);
  });

  it('a successful mutation through withAuth bumps the version', async () => {
    const store = fakeStore();
    setCacheStoreForTests(store);
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.manager.id);
    const path = `/api/v1/analytics/payment-mix?from=${EXPECTED.range.from}&to=${EXPECTED.range.to}`;
    expect((await call(paymentMixRoute, { path, cookie })).status).toBe(200);
    const versionBefore = (store.data.get('an:test:version') as number | undefined) ?? 0;
    const { POST: park } = await import('@/app/api/v1/sales/parked/route');
    const res = await call(park, { method: 'POST', path: '/api/v1/sales/parked', cookie, body: { label: 'x', cart: { lines: [], discount: { type: 'AMOUNT', value: 0 }, paymentMethod: 'CASH' } } });
    expect(res.status).toBe(201);
    expect(store.data.get('an:test:version')).toBe(versionBefore + 1);
  });
});
