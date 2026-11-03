import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { lowStock } from '@/services/low-stock';
import type { DashboardKpis, PaymentMethod } from '@/types';
import { returnLines, saleLines, stockOnHand } from './facts';
import { paymentMix } from './payment-mix';
import { previousRange, type AnalyticsRange } from './range';

/*
 * Dashboard KPIs (docs/plans/sprint-4.md, Global Constraints):
 *   totalCash   = Σ saleLines.revenue − Σ returnLines.refund            (rounded once)
 *   cogs        = Σ saleLines.cost − Σ returnLines.restocked_cost
 *   grossProfit = totalCash − cogs;  marginPct = profit ÷ revenue × 100 (1 decimal, 0 when no revenue)
 *   cashByMethod = sales revenue by payment method − refunds by refund method (all four keys)
 *   salesCount  = non-VOID sales created in range;  avgBasket = round(Σ sale totals ÷ salesCount)
 *   stock KPIs  = current stock on hand (stockOnHand(), not range-bound)
 *   low/out     = same rule as GET /stock/low
 *   deltas      = % change vs previousRange(r), 1 decimal; previous 0 → 0 if current 0 else 100
 */

interface PeriodTotals {
  revenue: number;
  cogs: number;
  marginPct: number;
  salesCount: number;
  salesTotal: number;
}

async function periodTotals(db: Db, r: AnalyticsRange): Promise<PeriodTotals> {
  const res = (await db.execute(sql`
    with sl as (${saleLines(r)}), rl as (${returnLines(r)}),
    t as (
      select (select coalesce(sum(revenue), 0) from sl) - (select coalesce(sum(refund), 0) from rl) as revenue,
             (select coalesce(sum(cost), 0) from sl) - (select coalesce(sum(restocked_cost), 0) from rl) as cogs
    ),
    s as (
      select count(*) as n, coalesce(sum(total), 0) as total
      from sales where status <> 'VOID' and created_at >= ${r.start} and created_at < ${r.end}
    )
    select round(t.revenue)::float8 as revenue, round(t.cogs)::float8 as cogs,
           coalesce(round((t.revenue - t.cogs) * 100 / nullif(t.revenue, 0), 1), 0)::float8 as margin_pct,
           s.n::int as sales_count, s.total::float8 as sales_total
    from t, s`)) as { rows: Record<string, unknown>[] };
  const row = res.rows[0] ?? {};
  return {
    revenue: Number(row.revenue) || 0,
    cogs: Number(row.cogs) || 0,
    marginPct: Number(row.margin_pct) || 0,
    salesCount: Number(row.sales_count) || 0,
    salesTotal: Number(row.sales_total) || 0,
  };
}

async function stockTotals(db: Db) {
  const res = (await db.execute(sql`
    with st as (${stockOnHand()})
    select coalesce(sum(qty), 0)::float8 as units,
           count(*) filter (where qty > 0)::int as skus,
           coalesce(sum(qty::numeric * cost_price), 0)::float8 as value_cost,
           coalesce(sum(qty::numeric * sell_price), 0)::float8 as value_retail
    from st`)) as { rows: Record<string, unknown>[] };
  const row = res.rows[0] ?? {};
  return {
    unitsInStock: Number(row.units) || 0,
    skusInStock: Number(row.skus) || 0,
    stockValueCost: Number(row.value_cost) || 0,
    stockValueRetail: Number(row.value_retail) || 0,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10 || 0;

/** Percent change, one decimal. A previous value of 0 gives 0 (no change) or 100 (from nothing). */
export function deltaPct(cur: number, prev: number): number {
  if (prev === 0) return cur === 0 ? 0 : 100;
  return round1(((cur - prev) / Math.abs(prev)) * 100);
}

const basket = (p: PeriodTotals) => (p.salesCount ? Math.round(p.salesTotal / p.salesCount) : 0);

export async function kpis(db: Db, r: AnalyticsRange): Promise<DashboardKpis> {
  const cur = await periodTotals(db, r);
  const prev = await periodTotals(db, previousRange(r));
  const mix = await paymentMix(db, r);
  const stock = await stockTotals(db);
  const low = await lowStock(db);

  const cashByMethod = Object.fromEntries(mix.map((m) => [m.method, m.total])) as Record<PaymentMethod, number>;
  const grossProfit = cur.revenue - cur.cogs;
  const avgBasket = basket(cur);
  return {
    totalCash: cur.revenue,
    cashByMethod,
    grossProfit,
    marginPct: cur.marginPct,
    cogs: cur.cogs,
    ...stock,
    salesCount: cur.salesCount,
    avgBasket,
    lowStockCount: low.low.length,
    outOfStockCount: low.out.length,
    deltas: {
      totalCash: deltaPct(cur.revenue, prev.revenue),
      grossProfit: deltaPct(grossProfit, prev.revenue - prev.cogs),
      salesCount: deltaPct(cur.salesCount, prev.salesCount),
      avgBasket: deltaPct(avgBasket, basket(prev)),
    },
  };
}
