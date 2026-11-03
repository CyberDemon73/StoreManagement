import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { brands, products, variants } from '@/db/schema';
import { toVariantWithProduct, type VariantWithProductOut } from '@/serializers/catalog';

export interface LowStockOut {
  low: VariantWithProductOut[];
  out: VariantWithProductOut[];
}

// Same tint rule as the product list/detail: first colour of the product's active variants.
const productTint = sql<string | null>`(
  select v2.color_hex from variants v2
  where v2.product_id = ${products.id} and v2.is_active
  order by v2.created_at, v2.id limit 1)`;

/** Active variants of ACTIVE products at or below their threshold, split into low (> 0) and out (<= 0). */
export async function lowStock(db: Db): Promise<LowStockOut> {
  const rows = await db
    .select({
      variant: variants,
      product: { id: products.id, name: products.name, baseSku: products.baseSku, images: products.images, brandName: brands.name, tint: productTint },
    })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .innerJoin(brands, eq(brands.id, products.brandId))
    .where(and(eq(products.status, 'ACTIVE'), eq(variants.isActive, true), lte(variants.quantity, variants.lowStockThreshold)))
    .orderBy(asc(products.name), asc(variants.size), asc(variants.id));
  const result: LowStockOut = { low: [], out: [] };
  for (const r of rows) {
    const out = toVariantWithProduct(r.variant, r.product);
    (r.variant.quantity > 0 ? result.low : result.out).push(out);
  }
  return result;
}

