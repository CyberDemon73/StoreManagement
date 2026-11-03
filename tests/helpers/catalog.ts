import { expect } from 'vitest';
import type { Db } from '@/db/client';
import { brands, categories, products, suppliers, variants, type ProductRow, type VariantRow } from '@/db/schema';
import { FORBIDDEN_SELLER_KEYS } from '@/serializers/seller';

export async function seedCatalog(db: Db) {
  const [brand] = await db.insert(brands).values({ name: 'Northline' }).returning();
  const [category] = await db.insert(categories).values({ name: 'Tops' }).returning();
  const [supplier] = await db.insert(suppliers).values({ name: 'Delta Textiles' }).returning();
  if (!brand || !category || !supplier) throw new Error('seedCatalog failed');
  return { brand, category, supplier };
}

export async function createProductDirect(
  db: Db,
  input: { name: string; baseSku: string; brandId: string; categoryId: string; defaultPrice: number; defaultCost?: number; status?: 'ACTIVE' | 'ARCHIVED'; images?: string[] },
): Promise<ProductRow> {
  const [row] = await db.insert(products).values(input).returning();
  if (!row) throw new Error('product insert failed');
  return row;
}

/**
 * Test-only fixture insert. `quantity` here bypasses the ledger on purpose to set up
 * list/filter scenarios quickly; production code must always go through applyMovement().
 */
export async function createVariantDirect(
  db: Db,
  input: { productId: string; size: string; colorName: string; colorHex?: string; sku: string; sellPrice: number; costPrice?: number; quantity?: number; lowStockThreshold?: number; barcode?: string; isActive?: boolean },
): Promise<VariantRow> {
  const [row] = await db
    .insert(variants)
    .values({ colorHex: '#000000', ...input })
    .returning();
  if (!row) throw new Error('variant insert failed');
  return row;
}

const FORBIDDEN = new Set<string>(FORBIDDEN_SELLER_KEYS);

function collectForbidden(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectForbidden(v, `${path}[${i}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN.has(k)) out.push(`${path}.${k}`);
      collectForbidden(v, `${path}.${k}`, out);
    }
  }
}

/** Deep scan: fails if any seller-forbidden key appears anywhere in the value. */
export function expectNoSellerKeys(value: unknown): void {
  const found: string[] = [];
  collectForbidden(value, '$', found);
  expect(found, `seller response leaks cost fields at: ${found.join(', ')}`).toEqual([]);
}
