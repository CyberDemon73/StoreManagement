import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { brands, categories, products, variants } from '@/db/schema';
import { toCsv } from '@/lib/csv';
import { formatMajor } from '@/lib/money';

/** Import columns (docs/plans/sprint-6.md) + sku, so an export dry-runs straight back in. */
export const EXPORT_COLUMNS = ['name', 'brand', 'category', 'size', 'color', 'colorHex', 'price', 'cost', 'qty', 'barcode', 'sku'] as const;

export type ProductExportRow = Record<(typeof EXPORT_COLUMNS)[number], string | number>;

/**
 * id → "Parent/Child/…" by walking parentId to the root. A leaf name alone is ambiguous once two
 * parents share it (Men/Shirts, Women/Shirts); the depth guard stops a corrupt parent cycle.
 */
export function categoryPaths(rows: { id: string; name: string; parentId: string | null }[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string>();
  for (const r of rows) {
    const parts: string[] = [];
    let at: typeof r | undefined = r;
    for (let depth = 0; at && depth < 32; depth++) {
      parts.unshift(at.name);
      at = at.parentId ? byId.get(at.parentId) : undefined;
    }
    out.set(r.id, parts.join('/'));
  }
  return out;
}

/** One row per active variant of an ACTIVE product, in catalogue order (brand, product, matrix order). */
export async function productExportRows(db: Db): Promise<ProductExportRow[]> {
  const [rows, categoryRows] = await Promise.all([
    db
      .select({
        name: products.name,
        brand: brands.name,
        categoryId: products.categoryId,
        size: variants.size,
        color: variants.colorName,
        colorHex: variants.colorHex,
        price: variants.sellPrice,
        cost: variants.costPrice,
        qty: variants.quantity,
        barcode: variants.barcode,
        sku: variants.sku,
      })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .innerJoin(brands, eq(brands.id, products.brandId))
      .where(and(eq(variants.isActive, true), eq(products.status, 'ACTIVE')))
      .orderBy(asc(brands.name), asc(products.name), asc(products.id), asc(variants.createdAt), asc(variants.id)),
    db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories),
  ]);
  const paths = categoryPaths(categoryRows);
  return rows.map(({ categoryId, ...r }) => ({
    name: r.name,
    brand: r.brand,
    category: paths.get(categoryId) ?? '',
    size: r.size,
    color: r.color,
    colorHex: r.colorHex,
    price: formatMajor(r.price),
    cost: r.cost == null ? '' : formatMajor(r.cost),
    qty: r.qty,
    barcode: r.barcode ?? '',
    sku: r.sku,
  }));
}

/** The CSV body; header-only when the catalogue is empty so the file is still a valid template. */
export async function productExportCsv(db: Db): Promise<string> {
  const rows = await productExportRows(db);
  if (rows.length === 0) return `﻿${EXPORT_COLUMNS.join(',')}\r\n`;
  return toCsv(rows, { bom: true });
}
