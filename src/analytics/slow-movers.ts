import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import type { SlowMover } from '@/types';
import { returnLines, saleLines, stockOnHand } from './facts';
import type { AnalyticsRange } from './range';

/*
 * Stock on hand (qty > 0) that has not sold for at least `days` days.
 *   lastSaleAt        = latest SALE movement, else earliest movement, else variant created_at
 *   daysSinceLastSale = floor((now − lastSaleAt) in days); included when ≥ days
 *   soldLast90d       = non-VOID units sold in the last 90 days − units returned in the last 90 days, floor 0
 *   valueAtCost       = qty × coalesce(cost_price, 0)
 *   suggestion        = > 90 'Markdown 20%', > 70 'Bundle', > 60 'Move to front', else 'Watch'
 * Sorted by valueAtCost desc.
 */
export const slowMoversQuery = z
  .object({ days: z.coerce.number().int().min(1).max(365).default(60) })
  .strict();

export type SlowMoversQuery = z.infer<typeof slowMoversQuery>;

/** Rolling window ending now (not a local-date range); only start/end are read by the facts. */
function lastDays(n: number): AnalyticsRange {
  return {
    from: '',
    to: '',
    tz: 'UTC',
    start: sql`now() - make_interval(days => ${n})`,
    end: sql`'infinity'::timestamptz`,
    days: n,
  };
}

export function suggestionFor(days: number): string {
  if (days > 90) return 'Markdown 20%';
  if (days > 70) return 'Bundle';
  if (days > 60) return 'Move to front';
  return 'Watch';
}

export async function slowMovers(db: Db, q: SlowMoversQuery): Promise<SlowMover[]> {
  const w = lastDays(90);
  const res = (await db.execute(sql`
    with soh as (${stockOnHand()}), sl as (${saleLines(w)}), rl as (${returnLines(w)}),
    last_sale as (
      select soh.variant_id,
             coalesce(
               (select max(m.created_at) from stock_movements m where m.variant_id = soh.variant_id and m.type = 'SALE'),
               (select min(m.created_at) from stock_movements m where m.variant_id = soh.variant_id),
               v.created_at) as at
      from soh join variants v on v.id = soh.variant_id
      where soh.qty > 0
    ),
    sold as (select variant_id, sum(qty) as qty from sl group by variant_id),
    returned as (select variant_id, sum(qty) as qty from rl group by variant_id)
    select soh.variant_id, p.name as product_name, b.name as brand, soh.size, soh.color_name, soh.color_hex, soh.sku,
           soh.qty::int as qty,
           floor(extract(epoch from (now() - ls.at)) / 86400)::int as days_since,
           (soh.qty * soh.cost_price)::int as value_at_cost,
           greatest(coalesce(sold.qty, 0) - coalesce(returned.qty, 0), 0)::int as sold_90
    from soh
    join last_sale ls on ls.variant_id = soh.variant_id
    join products p on p.id = soh.product_id
    join brands b on b.id = soh.brand_id
    left join sold on sold.variant_id = soh.variant_id
    left join returned on returned.variant_id = soh.variant_id
    where floor(extract(epoch from (now() - ls.at)) / 86400) >= ${q.days}
    order by value_at_cost desc, soh.sku asc`)) as {
    rows: {
      variant_id: string;
      product_name: string;
      brand: string;
      size: string;
      color_name: string;
      color_hex: string;
      sku: string;
      qty: number;
      days_since: number;
      value_at_cost: number;
      sold_90: number;
    }[];
  };
  return res.rows.map((x) => ({
    variantId: x.variant_id,
    productName: x.product_name,
    brand: x.brand,
    size: x.size,
    color: { name: x.color_name, hex: x.color_hex },
    sku: x.sku,
    qty: x.qty,
    daysSinceLastSale: x.days_since,
    valueAtCost: x.value_at_cost,
    soldLast90d: x.sold_90,
    suggestion: suggestionFor(x.days_since),
  }));
}
