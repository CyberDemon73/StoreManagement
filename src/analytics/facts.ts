import { sql, type SQL } from 'drizzle-orm';
import type { AnalyticsRange } from './range';

/*
 * The single definition of sales numbers every report builds on (docs/plans/sprint-4.md):
 *   revenue = Σ saleLines.revenue − Σ returnLines.refund
 *   cogs    = Σ saleLines.cost    − Σ returnLines.restocked_cost
 *   profit  = revenue − cogs
 *   units   = Σ saleLines.qty     − Σ returnLines.qty
 * Values are numeric (never int4 products, so no overflow); round once per output row.
 * A sale with subtotal 0 (all lines priced 0) contributes revenue 0, not NULL.
 */

/**
 * Non-VOID sale items of sales created in the range. `revenue` is the line's share of what was
 * paid after the sale-level discount; `cost` is the sale-time cost snapshot.
 */
export function saleLines(r: AnalyticsRange): SQL {
  return sql`
    select s.id as sale_id, si.id as sale_item_id, si.variant_id, v.product_id, p.brand_id, p.category_id,
           s.seller_id, s.payment_method, s.created_at, si.qty, si.unit_price,
           coalesce(si.line_total::numeric * s.total / nullif(s.subtotal, 0), 0) as revenue,
           coalesce(si.unit_cost, 0)::numeric * si.qty as cost,
           coalesce(si.line_total::numeric - si.line_total::numeric * s.total / nullif(s.subtotal, 0), 0) as discount_share
    from sales s
    join sale_items si on si.sale_id = s.id
    join variants v on v.id = si.variant_id
    join products p on p.id = v.product_id
    where s.status <> 'VOID' and s.created_at >= ${r.start} and s.created_at < ${r.end}`;
}

/**
 * Return items of returns created in the range (on non-VOID sales). The return's refund is spread
 * over its lines by list value; restocked lines give their cost back to stock.
 */
export function returnLines(r: AnalyticsRange): SQL {
  return sql`
    select rt.id as return_id, s.id as sale_id, si.id as sale_item_id, si.variant_id, v.product_id, p.brand_id,
           p.category_id, s.seller_id, rt.refund_method, rt.reason, rt.created_at, ri.qty, ri.restock,
           coalesce(rt.refund_amount::numeric * (si.unit_price::numeric * ri.qty)
              / nullif(sum(si.unit_price::numeric * ri.qty) over (partition by rt.id), 0), 0) as refund,
           (case when ri.restock then coalesce(si.unit_cost, 0)::numeric * ri.qty else 0 end) as restocked_cost
    from returns rt
    join sales s on s.id = rt.sale_id
    join return_items ri on ri.return_id = rt.id
    join sale_items si on si.id = ri.sale_item_id
    join variants v on v.id = si.variant_id
    join products p on p.id = v.product_id
    where s.status <> 'VOID' and rt.created_at >= ${r.start} and rt.created_at < ${r.end}`;
}

/** Current stock on hand of active variants of ACTIVE products (not range-bound). */
export function stockOnHand(): SQL {
  return sql`
    select v.id as variant_id, v.product_id, p.brand_id, p.category_id, v.size, v.color_name, v.color_hex, v.sku,
           greatest(v.quantity, 0) as qty, v.quantity as raw_qty, v.low_stock_threshold,
           coalesce(v.cost_price, 0) as cost_price, v.sell_price
    from variants v
    join products p on p.id = v.product_id
    where v.is_active and p.status = 'ACTIVE'`;
}
