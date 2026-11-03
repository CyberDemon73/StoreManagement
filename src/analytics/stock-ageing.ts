import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { stockOnHand } from './facts';

/*
 * Stock on hand split by days since the variant was last received
 * (latest INITIAL/PURCHASE movement, else variant created_at):
 *   '0-30' (≤ 30), '31-60', '61-90', '90+' (> 90).
 *   units = Σ qty, valueCost = Σ qty × coalesce(cost_price, 0). Always the four buckets, in order.
 */
export const stockAgeingQuery = z.object({}).strict();

export const AGEING_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const;

export interface AgeingBucket {
  bucket: (typeof AGEING_BUCKETS)[number];
  units: number;
  valueCost: number;
}

export async function stockAgeing(db: Db): Promise<AgeingBucket[]> {
  const res = (await db.execute(sql`
    with soh as (${stockOnHand()}),
    aged as (
      select soh.qty, soh.cost_price,
             floor(extract(epoch from (now() - coalesce(
               (select max(m.created_at) from stock_movements m
                 where m.variant_id = soh.variant_id and m.type in ('INITIAL', 'PURCHASE')),
               v.created_at))) / 86400) as days
      from soh join variants v on v.id = soh.variant_id
    )
    select case when days <= 30 then '0-30' when days <= 60 then '31-60' when days <= 90 then '61-90' else '90+' end as bucket,
           sum(qty)::int as units, sum(qty * cost_price)::int as value_cost
    from aged group by 1`)) as { rows: { bucket: string; units: number; value_cost: number }[] };
  const by = new Map(res.rows.map((r) => [r.bucket, r]));
  return AGEING_BUCKETS.map((bucket) => ({ bucket, units: by.get(bucket)?.units ?? 0, valueCost: by.get(bucket)?.value_cost ?? 0 }));
}
