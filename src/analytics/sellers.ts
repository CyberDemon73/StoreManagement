import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import type { SellerStats } from '@/types';
import { returnLines, saleLines } from './facts';
import type { AnalyticsRange } from './range';

/*
 * Per seller with any activity in the range — a non-VOID sale created in range, or a return created
 * in range on one of their (possibly older) sales — so Σ revenue reconciles with kpis.totalCash:
 *   salesCount    = non-VOID sales in range
 *   revenue       = Σ saleLines.revenue − Σ returnLines.refund (returns created in range on their sales)
 *   avgBasket     = round(Σ sale totals ÷ salesCount), 0 without sales
 *   discountGiven = Σ sale discounts (subtotal − total)
 *   discountPct   = discountGiven ÷ (Σ totals + discountGiven) × 100, one decimal
 *   returnsCount / returnsValue = returns created in range on their sales (count, Σ refund)
 *   returnRatePct = returnsCount ÷ salesCount × 100, one decimal, 0 without sales
 * Sales whose seller is NULL (user deleted) form one row: userId '' and name 'Unassigned'.
 * Sorted by revenue desc.
 */
export const UNASSIGNED = { userId: '', name: 'Unassigned' } as const;

export async function sellers(db: Db, r: AnalyticsRange): Promise<SellerStats[]> {
  const res = (await db.execute(sql`
    with sl as (${saleLines(r)}), rl as (${returnLines(r)}),
    s as (
      select coalesce(seller_id::text, '') as k, count(distinct sale_id) as sales_count,
             coalesce(sum(revenue), 0) as total, coalesce(sum(discount_share), 0) as discount
      from sl group by 1
    ),
    rt as (
      select coalesce(seller_id::text, '') as k, count(distinct return_id) as returns_count, coalesce(sum(refund), 0) as refund
      from rl group by 1
    ),
    j as (
      select coalesce(s.k, rt.k) as k, coalesce(s.sales_count, 0) as sales_count, coalesce(s.total, 0) as total,
             coalesce(s.discount, 0) as discount, coalesce(rt.returns_count, 0) as returns_count, coalesce(rt.refund, 0) as refund
      from s full join rt on rt.k = s.k
    )
    select j.k as user_id, coalesce(u.name, ${UNASSIGNED.name}) as name,
           j.sales_count::bigint as sales_count,
           round(j.total - j.refund)::float8 as revenue,
           coalesce(round(j.total / nullif(j.sales_count, 0)), 0)::float8 as avg_basket,
           round(j.discount)::float8 as discount_given,
           coalesce(round(j.discount * 100 / nullif(j.total + j.discount, 0), 1), 0)::float8 as discount_pct,
           j.returns_count::bigint as returns_count,
           round(j.refund)::float8 as returns_value,
           coalesce(round(j.returns_count::numeric * 100 / nullif(j.sales_count, 0), 1), 0)::float8 as return_rate_pct
    from j
    left join users u on u.id::text = j.k
    order by revenue desc, name asc, user_id asc`)) as {
    rows: {
      user_id: string;
      name: string;
      sales_count: number | string;
      revenue: number;
      avg_basket: number;
      discount_given: number;
      discount_pct: number;
      returns_count: number | string;
      returns_value: number;
      return_rate_pct: number;
    }[];
  };
  return res.rows.map((x) => ({
    userId: x.user_id,
    name: x.name,
    salesCount: Number(x.sales_count),
    revenue: Number(x.revenue) || 0,
    avgBasket: Number(x.avg_basket) || 0,
    discountGiven: Number(x.discount_given) || 0,
    discountPct: Number(x.discount_pct) || 0,
    returnsCount: Number(x.returns_count),
    returnsValue: Number(x.returns_value) || 0,
    returnRatePct: Number(x.return_rate_pct) || 0,
  }));
}
