import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { brands, products, variants } from '@/db/schema';
import { toVariantWithProduct, type VariantWithProductOut } from '@/serializers/catalog';
import { stripCostFields } from '@/serializers/seller';

// Same tint rule as the variant lookup/search (first active colour of the product).
const productTint = sql<string | null>`(
  select v2.color_hex from variants v2
  where v2.product_id = ${products.id} and v2.is_active
  order by v2.created_at, v2.id limit 1)`;

/**
 * Label data for the given variants, in request order (repeats kept so a caller can ask for
 * copies); unknown ids are dropped. Labels are printed and handed around, so cost fields are
 * stripped for every role, not just sellers.
 */
export async function labelData(db: Db, ids: string[]): Promise<VariantWithProductOut[]> {
  const unique = [...new Set(ids)];
  const rows = await db
    .select({
      variant: variants,
      product: { id: products.id, name: products.name, baseSku: products.baseSku, images: products.images, brandName: brands.name, tint: productTint },
    })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .innerJoin(brands, eq(brands.id, products.brandId))
    .where(inArray(variants.id, unique));
  const byId = new Map(rows.map((r) => [r.variant.id, stripCostFields(toVariantWithProduct(r.variant, r.product))]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
