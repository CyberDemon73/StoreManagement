import type { Db } from '@/db/client';
import { products, variants, type BrandRow, type CategoryRow, type ProductRow, type VariantRow } from '@/db/schema';
import { applyMovement } from '@/services/stock';
import { seedCatalog } from './catalog';

export interface StockFixture {
  brand: BrandRow;
  category: CategoryRow;
  product: ProductRow;
  /** A: qty 10 @ cost 500, B: qty 5 @ cost 500, C: qty 0 (no movement). Threshold 3. */
  variants: [VariantRow, VariantRow, VariantRow];
}

/** Catalogue with one product and three variants whose stock was booked through the ledger. */
export async function stockFixture(db: Db, userId: string | null = null): Promise<StockFixture> {
  const { brand, category } = await seedCatalog(db);
  const [product] = await db
    .insert(products)
    .values({ name: 'Chino Slim', baseSku: 'NO-CHI', brandId: brand.id, categoryId: category.id, defaultPrice: 1000, defaultCost: 500 })
    .returning();
  if (!product) throw new Error('product insert failed');
  const rows = await db
    .insert(variants)
    .values([
      { productId: product.id, size: 'S', colorName: 'Black', colorHex: '#000000', sku: 'NO-CHI-S-BLACK', barcode: '6220000000017', sellPrice: 1000, lowStockThreshold: 3 },
      { productId: product.id, size: 'M', colorName: 'Black', colorHex: '#000000', sku: 'NO-CHI-M-BLACK', barcode: '6220000000024', sellPrice: 1000, lowStockThreshold: 3 },
      { productId: product.id, size: 'L', colorName: 'Black', colorHex: '#000000', sku: 'NO-CHI-L-BLACK', barcode: '6220000000031', sellPrice: 1000, lowStockThreshold: 3 },
    ])
    .returning();
  const [a, b, c] = rows;
  if (!a || !b || !c) throw new Error('variant insert failed');
  await db.transaction(async (tx) => {
    await applyMovement(tx, { variantId: a.id, type: 'INITIAL', qtyDelta: 10, unitCost: 500, reason: 'fixture', userId });
    await applyMovement(tx, { variantId: b.id, type: 'INITIAL', qtyDelta: 5, unitCost: 500, reason: 'fixture', userId });
  });
  const fresh = await db.select().from(variants).orderBy(variants.size);
  const byId = new Map(fresh.map((v) => [v.id, v]));
  return { brand, category, product, variants: [byId.get(a.id)!, byId.get(b.id)!, byId.get(c.id)!] };
}
