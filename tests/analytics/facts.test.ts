import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as listSales } from '@/app/api/v1/sales/route';
import { getDb } from '@/db/client';
import { resolveRange } from '@/analytics/range';
import { returnLines, saleLines } from '@/analytics/facts';
import { bumpAnalyticsVersion, memo, setCacheStoreForTests } from '@/lib/cache';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

async function scalar(query: ReturnType<typeof sql>): Promise<Record<string, unknown>> {
  const res = (await getDb().execute(query)) as { rows: Record<string, unknown>[] };
  return res.rows[0] ?? {};
}

describe('resolveRange', () => {
  it('validates the range and rejects impossible input with VALIDATION', async () => {
    const db = getDb();
    await expect(resolveRange(db, { from: '2026-06-11', to: '2026-06-10' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(resolveRange(db, { from: '2025-01-01', to: '2026-02-04' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(resolveRange(db, { from: '2026-02-30', to: '2026-03-01' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const r = await resolveRange(db, EXPECTED.range);
    expect(r).toMatchObject({ from: '2026-06-10', to: '2026-06-11', tz: 'Africa/Cairo', days: 2 });
  });
});

describe('shared facts', () => {
  it('attributes sales to local days: S3 at 00:30 Cairo belongs to 06-11, not 06-10', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const r = await resolveRange(db, { from: '2026-06-10', to: '2026-06-10' });
    const res = (await db.execute(sql`with sl as (${saleLines(r)}) select distinct sale_id from sl`)) as { rows: { sale_id: string }[] };
    expect(res.rows.map((x) => x.sale_id).sort()).toEqual([fx.saleIds.s1, fx.saleIds.s2].sort());
  });

  it('defines revenue and cost of goods once: 4833 revenue, 2200 cogs, VOID excluded', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const r = await resolveRange(db, EXPECTED.range);
    const row = await scalar(sql`
      with sl as (${saleLines(r)}), rl as (${returnLines(r)})
      select
        round((select coalesce(sum(revenue), 0) from sl) - (select coalesce(sum(refund), 0) from rl))::int as revenue,
        round((select coalesce(sum(cost), 0) from sl) - (select coalesce(sum(restocked_cost), 0) from rl))::int as cogs,
        (select coalesce(sum(qty), 0) from sl)::int - (select coalesce(sum(qty), 0) from rl)::int as units,
        (select count(*) from sl where sale_id = ${fx.saleIds.s4})::int as void_lines`);
    expect(row).toEqual({ revenue: EXPECTED.revenue, cogs: EXPECTED.cogs, units: EXPECTED.unitsSold, void_lines: 0 });
  });
});

describe('timezone-aware lists', () => {
  it('GET /sales?from=to=2026-06-11 returns S3 (00:30 Cairo) and S4, not S2', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const cookie = await sessionCookieFor(db, fx.manager.id);
    const res = await call(listSales, { path: '/api/v1/sales?from=2026-06-11&to=2026-06-11', cookie });
    expect(res.status).toBe(200);
    const ids = (await res.json()).data.map((s: { id: string }) => s.id).sort();
    expect(ids).toEqual([fx.saleIds.s3, fx.saleIds.s4].sort());
  });
});

describe('cache without Upstash', () => {
  it('memo calls the function every time and version bumps are no-ops', async () => {
    let calls = 0;
    const fn = async () => ++calls;
    expect(await memo('an:test', fn)).toBe(1);
    expect(await memo('an:test', fn)).toBe(2);
    await expect(bumpAnalyticsVersion()).resolves.toBeUndefined();
  });
});

describe('cache key scope', () => {
  it('prefixes keys with the deployment environment so preview and production never share entries', async () => {
    const data = new Map<string, unknown>();
    setCacheStoreForTests({ get: async <T>(k: string) => (data.has(k) ? (data.get(k) as T) : null), set: async (k, v) => { data.set(k, v); }, incr: async () => 1 });
    await memo('report:x', async () => 1);
    setCacheStoreForTests(null);
    expect([...data.keys()].every((k) => k.startsWith('an:test:'))).toBe(true);
  });
});
