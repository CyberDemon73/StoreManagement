import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import type { ColorRef, TopProduct } from '@/types';
import { returnLines, saleLines } from './facts';
import { rangeQuery, type AnalyticsRange } from './range';

/*
 * Per product (or variant) with activity in the range:
 *   units   = Σ saleLines.qty − Σ returnLines.qty
 *   revenue = Σ saleLines.revenue − Σ returnLines.refund
 *   profit  = revenue − (Σ saleLines.cost − Σ returnLines.restocked_cost)
 *   marginPct = profit ÷ revenue × 100 (0 when revenue ≤ 0), one decimal
 * Sorted by `by` desc, then product name (then sku for variants); VOID sales never appear (facts).
 */

export const TOP_BY = ['units', 'revenue', 'profit'] as const;
export type TopBy = (typeof TOP_BY)[number];

export const topQuery = rangeQuery
  .extend({
    by: z.enum(TOP_BY).default('units'),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

export interface TopOptions {
  by: TopBy;
  limit: number;
}

export interface TopVariant extends Required<TopProduct> {
  variantId: string;
  size: string;
  color: ColorRef;
  sku: string;
}

// Whitelisted identifiers only; `by` is validated by the enum above before it gets here.
const ORDER: Record<TopBy, string> = { units: '"units"', revenue: '"revenue"', profit: '"profit"' };

function aggregated(r: AnalyticsRange, key: 'product_id' | 'variant_id') {
  const k = sql.raw(key);
  return sql`
    sl as (${saleLines(r)}), rl as (${returnLines(r)}),
    flow as (
      select ${k} as k, qty, revenue, cost from sl
      union all
      select ${k}, -qty, -refund, -restocked_cost from rl
    ),
    a as (select k, sum(qty) as units, sum(revenue) as revenue, sum(revenue) - sum(cost) as profit from flow group by k)`;
}

const measures = sql`
  a.units::float8 as "units",
  round(a.revenue)::float8 as "revenue",
  round(a.profit)::float8 as "profit",
  (case when a.revenue > 0 then round(a.profit / a.revenue * 100, 1) else 0 end)::float8 as "marginPct"`;

export async function topProducts(db: Db, r: AnalyticsRange, o: TopOptions): Promise<Required<TopProduct>[]> {
  const res = (await db.execute(sql`
    with ${aggregated(r, 'product_id')}
    select p.id as "productId", p.name, coalesce(b.name, '') as brand, ${measures}
    from a
    join products p on p.id = a.k
    left join brands b on b.id = p.brand_id
    order by ${sql.raw(ORDER[o.by])} desc, p.name asc, p.id asc
    limit ${o.limit}`)) as { rows: Required<TopProduct>[] };
  return res.rows;
}

export async function topVariants(db: Db, r: AnalyticsRange, o: TopOptions): Promise<TopVariant[]> {
  const res = (await db.execute(sql`
    with ${aggregated(r, 'variant_id')}
    select v.id as "variantId", p.id as "productId", p.name, coalesce(b.name, '') as brand,
           v.size, v.color_name, v.color_hex, v.sku, ${measures}
    from a
    join variants v on v.id = a.k
    join products p on p.id = v.product_id
    left join brands b on b.id = p.brand_id
    order by ${sql.raw(ORDER[o.by])} desc, p.name asc, v.sku asc
    limit ${o.limit}`)) as { rows: (Omit<TopVariant, 'color'> & { color_name: string; color_hex: string })[] };
  return res.rows.map(({ color_name, color_hex, ...v }) => ({ ...v, color: { name: color_name, hex: color_hex } }));
}
