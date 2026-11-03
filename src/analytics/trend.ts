import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import type { TrendPoint } from '@/types';
import { returnLines, saleLines } from './facts';
import { rangeQuery, type AnalyticsRange } from './range';

/*
 * Sales trend per local bucket (store timezone), every bucket in the range present (zero-filled):
 *   revenue = Σ saleLines.revenue of sales created in the bucket − Σ returnLines.refund of returns created in it
 *   cogs    = Σ saleLines.cost − Σ returnLines.restocked_cost (same bucketing)
 *   profit  = revenue − cogs;  count = non-VOID sales created in the bucket
 * Buckets: date_trunc(interval, created_at AT TIME ZONE tz); week starts Monday, month on the 1st;
 * labels YYYY-MM-DD.
 */

export const TREND_INTERVALS = ['day', 'week', 'month'] as const;
export type TrendInterval = (typeof TREND_INTERVALS)[number];

export const trendQuery = rangeQuery.extend({ interval: z.enum(TREND_INTERVALS).default('day') }).strict();

export async function trend(db: Db, r: AnalyticsRange, interval: TrendInterval = 'day'): Promise<TrendPoint[]> {
  const unit = sql`${interval}::text`;
  const res = (await db.execute(sql`
    with sl as (${saleLines(r)}), rl as (${returnLines(r)}),
    b as (
      select generate_series(
        date_trunc(${unit}, (${r.from})::date::timestamp),
        date_trunc(${unit}, (${r.to})::date::timestamp),
        ('1 ' || ${unit})::interval) as bucket
    ),
    sa as (
      select date_trunc(${unit}, created_at at time zone ${r.tz}) as bucket,
             coalesce(sum(revenue), 0) as revenue, sum(cost) as cost, count(distinct sale_id) as n
      from sl group by 1
    ),
    re as (
      select date_trunc(${unit}, created_at at time zone ${r.tz}) as bucket,
             coalesce(sum(refund), 0) as refund, sum(restocked_cost) as restocked
      from rl group by 1
    )
    select to_char(b.bucket, 'YYYY-MM-DD') as bucket,
           round(coalesce(sa.revenue, 0) - coalesce(re.refund, 0))::float8 as revenue,
           round(coalesce(sa.cost, 0) - coalesce(re.restocked, 0))::float8 as cogs,
           coalesce(sa.n, 0)::int as count
    from b
    left join sa on sa.bucket = b.bucket
    left join re on re.bucket = b.bucket
    order by b.bucket`)) as { rows: { bucket: string; revenue: number; cogs: number; count: number }[] };
  return res.rows.map((row) => {
    const revenue = Number(row.revenue) || 0;
    const cogs = Number(row.cogs) || 0;
    return { bucket: row.bucket, revenue, profit: revenue - cogs, cogs, count: Number(row.count) };
  });
}
