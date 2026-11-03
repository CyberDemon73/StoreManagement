import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import type { SellerStats } from '@/types';
import { returnLines, saleLines } from './facts';
import type { AnalyticsRange } from './range';

/*
 * Per seller (users with ≥ 1 non-VOID sale created in the range):
 *   salesCount    = non-VOID sales in range
 *   revenue       = Σ saleLines.revenue − Σ returnLines.refund (returns created in range on their sales)
 *   avgBasket     = round(Σ sale totals ÷ salesCount)
 *   discountGiven = Σ sale discounts (subtotal − total)
 *   discountPct   = discountGiven ÷ (Σ totals + discountGiven) × 100, one decimal
 *   returnsCount / returnsValue = returns created in range on their sales (count, Σ refund)
 *   returnRatePct = returnsCount ÷ salesCount × 100, one decimal
 * Sorted by revenue desc.
 */
export async function sellers(db: Db, r: AnalyticsRange): Promise<SellerStats[]> {
  const res = (await db.execute(sql`
    with sl as (${saleLines(r)}), rl as (${returnLines(r)}),
    s as (
      select seller_id, count(distinct sale_id) as sales_count,
             coalesce(sum(revenue), 0) as total, coalesce(sum(discount_share), 0) as discount
      from sl where seller_id is not null group by seller_id
    ),
    rt as (
      select seller_id, count(distinct return_id) as returns_count, coalesce(sum(refund), 0) as refund
      from rl where seller_id is not null group by seller_id
    )
    select u.id as user_id, u.name,
           s.sales_count::int as sales_count,
           round(s.total - coalesce(rt.refund, 0))::int as revenue,
           round(s.total / s.sales_count)::int as avg_basket,
           round(s.discount)::int as discount_given,
           coalesce(round(s.discount * 100 / nullif(s.total + s.discount, 0), 1), 0)::float8 as discount_pct,
           coalesce(rt.returns_count, 0)::int as returns_count,
           round(coalesce(rt.refund, 0))::int as returns_value,
           round(coalesce(rt.returns_count, 0)::numeric * 100 / s.sales_count, 1)::float8 as return_rate_pct
    from s
    join users u on u.id = s.seller_id
    left join rt on rt.seller_id = s.seller_id
    order by revenue desc, u.name asc`)) as {
    rows: {
      user_id: string;
      name: string;
      sales_count: number;
      revenue: number;
      avg_basket: number;
      discount_given: number;
      discount_pct: number;
      returns_count: number;
      returns_value: number;
      return_rate_pct: number;
    }[];
  };
  return res.rows.map((x) => ({
    userId: x.user_id,
    name: x.name,
    salesCount: x.sales_count,
    revenue: x.revenue,
    avgBasket: x.avg_basket,
    discountGiven: x.discount_given,
    discountPct: Number(x.discount_pct),
    returnsCount: x.returns_count,
    returnsValue: x.returns_value,
    returnRatePct: Number(x.return_rate_pct),
  }));
}
