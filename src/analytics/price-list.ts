import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { paginationQuery } from '@/schemas/common';
import { escapeLike } from '@/services/products-list';
import type { ColorRef } from '@/types';

/*
 * Active variants of ACTIVE products with cost, price and stock (manager-only, so cost is fine here).
 *   marginPct = (sellPrice − costPrice) ÷ sellPrice × 100, one decimal; null when no cost or price 0.
 *   quantity  = raw variants.quantity.
 * Ordered by product name, size, sku. `q` matches sku or product name (ILIKE, escaped).
 */
export const priceListQuery = paginationQuery.extend({ q: z.string().trim().min(1).max(100).optional() }).strict();

export type PriceListQuery = z.infer<typeof priceListQuery>;

/** CSV export cap (the JSON endpoint pages at ≤ 100). */
export const PRICE_LIST_EXPORT_MAX = 5000;

export interface PriceListRow {
  variantId: string;
  productName: string;
  brand: string;
  sku: string;
  size: string;
  color: ColorRef;
  costPrice: number | null;
  sellPrice: number;
  marginPct: number | null;
  quantity: number;
}

export interface PriceListPage {
  data: PriceListRow[];
  page: number;
  pageSize: number;
  total: number;
}

function filter(q?: string): SQL {
  const base = sql`v.is_active and p.status = 'ACTIVE'`;
  if (!q) return base;
  const like = `%${escapeLike(q)}%`;
  return sql`${base} and (v.sku ilike ${like} escape '\\' or p.name ilike ${like} escape '\\')`;
}

/** Rows for the given window; shared by the JSON endpoint and the CSV export. */
export async function priceListRows(db: Db, q: string | undefined, limit: number, offset: number): Promise<PriceListRow[]> {
  const res = (await db.execute(sql`
    select v.id, p.name as product_name, b.name as brand, v.sku, v.size, v.color_name, v.color_hex,
           v.cost_price, v.sell_price, v.quantity,
           case when v.cost_price is null or v.sell_price = 0 then null
                else round((v.sell_price - v.cost_price)::numeric * 100 / v.sell_price, 1)::float8 end as margin_pct
    from variants v
    join products p on p.id = v.product_id
    join brands b on b.id = p.brand_id
    where ${filter(q)}
    order by p.name asc, v.size asc, v.sku asc
    limit ${limit} offset ${offset}`)) as {
    rows: {
      id: string;
      product_name: string;
      brand: string;
      sku: string;
      size: string;
      color_name: string;
      color_hex: string;
      cost_price: number | null;
      sell_price: number;
      quantity: number;
      margin_pct: number | null;
    }[];
  };
  return res.rows.map((x) => ({
    variantId: x.id,
    productName: x.product_name,
    brand: x.brand,
    sku: x.sku,
    size: x.size,
    color: { name: x.color_name, hex: x.color_hex },
    costPrice: x.cost_price,
    sellPrice: x.sell_price,
    marginPct: x.margin_pct == null ? null : Number(x.margin_pct),
    quantity: x.quantity,
  }));
}

export async function priceList(db: Db, q: PriceListQuery): Promise<PriceListPage> {
  const data = await priceListRows(db, q.q, q.pageSize, (q.page - 1) * q.pageSize);
  const count = (await db.execute(sql`
    select count(*)::int as total
    from variants v join products p on p.id = v.product_id
    where ${filter(q.q)}`)) as { rows: { total: number }[] };
  return { data, page: q.page, pageSize: q.pageSize, total: count.rows[0]?.total ?? 0 };
}
