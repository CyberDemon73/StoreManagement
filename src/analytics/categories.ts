import type { Db } from '@/db/client';
import type { CategoryStats } from '@/types';
import { dimensionStats } from './brands';
import type { AnalyticsRange } from './range';

/*
 * Per active category, over the range — same definitions as the brands report:
 *   revenue = Σ saleLines.revenue − Σ returnLines.refund; profit = revenue − cogs;
 *   unitsSold = Σ saleLines.qty − Σ returnLines.qty; marginPct = profit ÷ revenue × 100 (one decimal).
 *   daysOfCover = round(unitsInStock ÷ (unitsSold ÷ range days)), 999 when unitsSold ≤ 0.
 * Stock figures are current on-hand of active variants of ACTIVE products.
 */

export const NO_COVER = 999;

export async function categories(db: Db, r: AnalyticsRange): Promise<CategoryStats[]> {
  const rows = await dimensionStats(db, r, 'category');
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    unitsInStock: c.unitsInStock,
    unitsSold: c.unitsSold,
    stockValueCost: c.stockValueCost,
    stockValueRetail: c.stockValueRetail,
    revenue: c.revenue,
    profit: c.profit,
    marginPct: c.marginPct,
    daysOfCover: c.unitsSold > 0 ? Math.round(c.unitsInStock / (c.unitsSold / r.days)) : NO_COVER,
  }));
}
