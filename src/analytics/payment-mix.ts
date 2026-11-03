import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import type { PaymentMethod } from '@/types';
import { returnLines, saleLines } from './facts';
import type { AnalyticsRange } from './range';

/*
 * Payment mix over the range, one row per method (always all four, in this order):
 *   count = distinct non-VOID sales paid with the method
 *   total = Σ saleLines.revenue of those sales − Σ returnLines.refund refunded by that method
 * Rounded to integer minor units once per row.
 */

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['CASH', 'CARD', 'WALLET', 'TRANSFER'];

export interface PaymentMixRow {
  method: PaymentMethod;
  count: number;
  total: number;
}

export async function paymentMix(db: Db, r: AnalyticsRange): Promise<PaymentMixRow[]> {
  const res = (await db.execute(sql`
    with sl as (${saleLines(r)}), rl as (${returnLines(r)}),
    sa as (select payment_method::text as method, count(distinct sale_id) as n, sum(revenue) as v from sl group by 1),
    re as (select refund_method::text as method, sum(refund) as v from rl group by 1)
    select m.method, coalesce(sa.n, 0)::int as count, round(coalesce(sa.v, 0) - coalesce(re.v, 0))::float8 as total
    from unnest(array['CASH', 'CARD', 'WALLET', 'TRANSFER']::text[]) with ordinality as m(method, ord)
    left join sa on sa.method = m.method
    left join re on re.method = m.method
    order by m.ord`)) as { rows: { method: PaymentMethod; count: number; total: number }[] };
  return res.rows.map((row) => ({ method: row.method, count: Number(row.count), total: Number(row.total) || 0 }));
}
