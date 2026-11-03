import { asc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { brands, categories, products, variants } from '@/db/schema';
import { toCsv } from '@/lib/csv';
import { formatMajor } from '@/lib/money';

/** Import columns (docs/plans/sprint-6.md) + sku, so an export dry-runs straight back in. */
export const EXPORT_COLUMNS = ['name', 'brand', 'category', 'size', 'color', 'colorHex', 'price', 'cost', 'qty', 'barcode', 'sku'] as const;

export type ProductExportRow = Record<(typeof EXPORT_COLUMNS)[number], string | number>;

/** One row per active variant, in catalogue order (brand, product, matrix order). */
export async function productExportRows(db: Db): Promise<ProductExportRow[]> {
  const rows = await db
    .select({
      name: products.name,
      brand: brands.name,
      category: categories.name,
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
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(variants.isActive, true))
    .orderBy(asc(brands.name), asc(products.name), asc(products.id), asc(variants.createdAt), asc(variants.id));
  return rows.map((r) => ({
    ...r,
    price: formatMajor(r.price),
    cost: r.cost == null ? '' : formatMajor(r.cost),
    barcode: r.barcode ?? '',
  }));
}

/** The CSV body; header-only when the catalogue is empty so the file is still a valid template. */
export async function productExportCsv(db: Db): Promise<string> {
  const rows = await productExportRows(db);
  if (rows.length === 0) return `﻿${EXPORT_COLUMNS.join(',')}\r\n`;
  return toCsv(rows, { bom: true });
}
