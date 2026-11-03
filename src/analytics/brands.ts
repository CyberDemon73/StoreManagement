import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import type { BrandSplit } from '@/types';
import { returnLines, saleLines, stockOnHand } from './facts';
import type { AnalyticsRange } from './range';

/*
 * Per brand (every active brand, zeros included, plus any retired brand with sales/returns in range,
 * so the rows always reconcile with kpis.totalCash), over the range:
 *   revenue    = Σ saleLines.revenue − Σ returnLines.refund
 *   profit     = revenue − (Σ saleLines.cost − Σ returnLines.restocked_cost)
 *   unitsSold  = Σ saleLines.qty − Σ returnLines.qty
 *   marginPct  = profit ÷ revenue × 100 (0 when revenue ≤ 0), one decimal
 *   sharePct   = revenue ÷ Σ revenue of all brands × 100 (0 when that is 0), one decimal
 * Stock figures are current on-hand of active variants of ACTIVE products (not range-bound).
 * Aggregated in numeric, rounded once per row.
 */

export interface DimensionStats {
  id: string;
  name: string;
  unitsInStock: number;
  stockValueCost: number;
  stockValueRetail: number;
  unitsSold: number;
  revenue: number;
  profit: number;
  marginPct: number;
  sharePct: number;
}

export type BrandStats = DimensionStats;

/** Shared by brands and categories: the same numbers grouped by `products.brand_id` or `products.category_id`. */
export async function dimensionStats(db: Db, r: AnalyticsRange, dim: 'brand' | 'category'): Promise<DimensionStats[]> {
  const key = sql.raw(dim === 'brand' ? 'brand_id' : 'category_id');
  const table = sql.raw(dim === 'brand' ? 'brands' : 'categories');
  const res = (await db.execute(sql`
    with sl as (${saleLines(r)}), rl as (${returnLines(r)}), soh as (${stockOnHand()}),
    flow as (
      select ${key} as k, qty, revenue, cost from sl
      union all
      select ${key}, -qty, -refund, -restocked_cost from rl
    ),
    f as (select k, sum(qty) as units, sum(revenue) as revenue, sum(revenue) - sum(cost) as profit from flow group by k),
    st as (
      select ${key} as k, sum(qty) as units, sum(qty::numeric * cost_price) as value_cost, sum(qty::numeric * sell_price) as value_retail
      from soh group by ${key}
    ),
    rows as (
      select d.id, d.name,
             coalesce(st.units, 0) as units_in_stock, coalesce(st.value_cost, 0) as value_cost,
             coalesce(st.value_retail, 0) as value_retail, coalesce(f.units, 0) as units_sold,
             coalesce(f.revenue, 0) as revenue, coalesce(f.profit, 0) as profit
      from ${table} d
      left join f on f.k = d.id
      left join st on st.k = d.id
      where d.is_active or f.k is not null
    )
    select id, name,
           units_in_stock::float8 as "unitsInStock",
           round(value_cost)::float8 as "stockValueCost",
           round(value_retail)::float8 as "stockValueRetail",
           units_sold::float8 as "unitsSold",
           round(revenue)::float8 as "revenue",
           round(profit)::float8 as "profit",
           (case when revenue > 0 then round(profit / revenue * 100, 1) else 0 end)::float8 as "marginPct",
           coalesce(round(revenue / nullif(sum(revenue) over (), 0) * 100, 1), 0)::float8 as "sharePct"
    from rows
    order by revenue desc, name asc, id asc`)) as { rows: DimensionStats[] };
  return res.rows;
}

export async function brands(db: Db, r: AnalyticsRange): Promise<BrandStats[]> {
  return dimensionStats(db, r, 'brand');
}

/** Dashboard slice of the brands report. */
export async function brandSplit(db: Db, r: AnalyticsRange): Promise<BrandSplit[]> {
  return (await brands(db, r)).map(({ id, name, revenue, sharePct }) => ({ id, name, revenue, sharePct }));
}
