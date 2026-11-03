import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import type { ReturnsReport } from '@/types';
import { returnLines, saleLines } from './facts';
import type { AnalyticsRange } from './range';

/*
 *   count    = returns created in range (on non-VOID sales)
 *   value    = Σ returnLines.refund of those returns
 *   ratePct  = count ÷ non-VOID sales created in range × 100, one decimal (0 when no sales)
 *   byReason = count and value per reason, count desc
 */
export async function returnsReport(db: Db, r: AnalyticsRange): Promise<ReturnsReport> {
  const res = (await db.execute(sql`
    with sl as (${saleLines(r)}), rl as (${returnLines(r)}),
    per_return as (select return_id, reason, sum(refund) as refund from rl group by return_id, reason),
    totals as (
      select count(*)::int as count, round(coalesce(sum(refund), 0))::float8 as value,
             (select count(distinct sale_id) from sl) as sales_count
      from per_return
    )
    select t.count, t.value,
           coalesce(round(t.count::numeric * 100 / nullif(t.sales_count, 0), 1), 0)::float8 as rate_pct,
           coalesce(
             (select json_agg(json_build_object('reason', reason, 'count', count, 'value', value) order by count desc, reason asc)
              from (select reason, count(*)::int as count, round(sum(refund))::float8 as value from per_return group by reason) b),
             '[]'::json) as by_reason
    from totals t`)) as {
    rows: { count: number; value: number; rate_pct: number; by_reason: ReturnsReport['byReason'] }[];
  };
  const row = res.rows[0]!;
  return { ratePct: Number(row.rate_pct), count: Number(row.count), value: Number(row.value), byReason: row.by_reason };
}
