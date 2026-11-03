import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb, type Db } from './client';

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

if (process.argv[1]?.endsWith('verify-stock.ts')) {
  verifyStock(getDb())
    .then(({ ok, mismatches }) => {
      if (ok) {
        console.log('stock:verify OK — every variant matches its ledger');
        process.exit(0);
      }
      console.error(`stock:verify FAILED — ${mismatches.length} mismatch(es)`);
      for (const m of mismatches) console.error(`  ${m.variantId}: quantity=${m.quantity} ledger=${m.ledger}`);
      process.exit(1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
