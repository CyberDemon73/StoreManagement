import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';

export interface StockMismatch {
  variantId: string;
  quantity: number;
  ledger: number;
}

/** Invariant: variants.quantity must equal Σ stock_movements.qty_delta for every variant. */
export async function verifyStock(db: Db): Promise<{ ok: boolean; mismatches: StockMismatch[] }> {
  const result = (await db.execute(sql`
    select v.id as variant_id, v.quantity, coalesce(sum(m.qty_delta), 0)::int as ledger
    from variants v
    left join stock_movements m on m.variant_id = v.id
    group by v.id, v.quantity
    having v.quantity <> coalesce(sum(m.qty_delta), 0)
    order by v.id
  `)) as { rows: { variant_id: string; quantity: number; ledger: number }[] };
  const mismatches = result.rows.map((r) => ({ variantId: r.variant_id, quantity: Number(r.quantity), ledger: Number(r.ledger) }));
  return { ok: mismatches.length === 0, mismatches };
}
