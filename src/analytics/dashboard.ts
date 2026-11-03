import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { sales, users } from '@/db/schema';
import type { VariantWithProductOut } from '@/serializers/catalog';
import type { SaleOut } from '@/serializers/sales';
import { lowStock } from '@/services/low-stock';
import { loadSalesOut } from '@/services/sales';
import type { DashboardData, TopProduct } from '@/types';
import { brandSplit } from './brands';
import { returnLines, saleLines } from './facts';
import { kpis } from './kpis';
import type { AnalyticsRange } from './range';
import { trend } from './trend';

/*
 * Dashboard = kpis + day trend + brand split + top 5 products by units + low stock (out first, ≤ 6)
 * + 6 most recent sales. Brand and product figures use the shared facts:
 *   revenue = Σ saleLines.revenue − Σ returnLines.refund;  units = Σ saleLines.qty − Σ returnLines.qty
 *   profit  = revenue − (Σ saleLines.cost − Σ returnLines.restocked_cost);  marginPct = profit ÷ revenue × 100 (0 when revenue ≤ 0)
 *   sharePct = brand revenue ÷ total revenue × 100 (1 decimal)
 */

export type DashboardOut = Omit<DashboardData, 'lowStock' | 'recentSales'> & {
  lowStock: VariantWithProductOut[];
  recentSales: SaleOut[];
};

const DASHBOARD_LIST = 6;
const TOP_PRODUCTS = 5;

async function topProducts(db: Db, r: AnalyticsRange): Promise<TopProduct[]> {
  const res = (await db.execute(sql`
    with sl as (${saleLines(r)}), rl as (${returnLines(r)}),
    x as (
      select product_id, qty, coalesce(revenue, 0) as revenue, cost from sl
      union all
      select product_id, -qty, -coalesce(refund, 0), -restocked_cost from rl
    ),
    t as (select product_id, sum(qty) as units, sum(revenue) as revenue, sum(cost) as cost from x group by 1)
    select p.id as product_id, p.name, b.name as brand, t.units::float8 as units,
           round(t.revenue)::float8 as revenue, round(t.revenue - t.cost)::float8 as profit,
           (case when t.revenue > 0 then round((t.revenue - t.cost) * 100 / t.revenue, 1) else 0 end)::float8 as margin_pct
    from t
    join products p on p.id = t.product_id
    join brands b on b.id = p.brand_id
    order by t.units desc, t.revenue desc, p.name, p.id
    limit ${TOP_PRODUCTS}`)) as { rows: Record<string, unknown>[] };
  return res.rows.map((row) => ({
    productId: String(row.product_id),
    name: String(row.name),
    brand: String(row.brand),
    units: Number(row.units),
    revenue: Number(row.revenue) || 0,
    profit: Number(row.profit) || 0,
    marginPct: Number(row.margin_pct) || 0,
  }));
}

async function recentSales(db: Db): Promise<SaleOut[]> {
  const rows = await db
    .select({ sale: sales, sellerName: users.name })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.sellerId))
    .orderBy(desc(sales.createdAt), desc(sales.id))
    .limit(DASHBOARD_LIST);
  return loadSalesOut(
    db,
    rows.map((x) => x.sale),
    new Map(rows.map((x) => [x.sale.id, x.sellerName])),
  );
}

export async function dashboard(db: Db, r: AnalyticsRange): Promise<DashboardOut> {
  const k = await kpis(db, r);
  const points = await trend(db, r, 'day');
  const brands = await brandSplit(db, r);
  const top = await topProducts(db, r);
  const low = await lowStock(db);
  const recent = await recentSales(db);
  return {
    kpis: k,
    trend: points,
    brandSplit: brands,
    topProducts: top,
    lowStock: [...low.out, ...low.low].slice(0, DASHBOARD_LIST),
    recentSales: recent,
  };
}
