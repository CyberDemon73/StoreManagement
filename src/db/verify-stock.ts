import 'dotenv/config';
import { verifyStock } from '../services/stock-verify';
import { getDb } from './client';

// The check itself lives in services/ so the weekly cron can share it without pulling in
// dotenv (a dev dependency) or this script's process.exit side effects.
export { verifyStock, type StockMismatch } from '../services/stock-verify';

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
