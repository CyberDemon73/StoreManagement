import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { brands, categories, products, stockMovements, suppliers, variants } from '@/db/schema';

async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return ((e as Error).cause as { code?: string } | undefined)?.code;
  }
  return undefined;
}

async function fixture() {
  const db = getDb();
  const [b] = await db.insert(brands).values({ name: 'Northline' }).returning();
  const [c] = await db.insert(categories).values({ name: 'Tops' }).returning();
  const [p] = await db
    .insert(products)
    .values({ name: 'Chino Slim', brandId: b!.id, categoryId: c!.id, baseSku: 'NO-CHI', defaultPrice: 1000 })
    .returning();
  return { db, brand: b!, category: c!, product: p! };
}

describe('catalog schema', () => {
  it('creates all catalogue and ledger tables', async () => {
    const db = getDb();
    for (const t of [brands, categories, suppliers, products, variants, stockMovements]) {
      expect(await db.select().from(t)).toEqual([]);
    }
  });

  it('enforces unique sku and unique (product, size, color) on variants, nullable unique barcode', async () => {
    const { db, product } = await fixture();
    const base = { productId: product.id, colorHex: '#000000', sellPrice: 1000 };
    await db.insert(variants).values({ ...base, size: 'S', colorName: 'Black', sku: 'NO-CHI-S-BLACK' });
    expect(await pgCode(db.insert(variants).values({ ...base, size: 'S', colorName: 'Black', sku: 'OTHER' }))).toBe('23505');
    expect(await pgCode(db.insert(variants).values({ ...base, size: 'M', colorName: 'Black', sku: 'NO-CHI-S-BLACK' }))).toBe('23505');
    await db.insert(variants).values({ ...base, size: 'M', colorName: 'Black', sku: 'NO-CHI-M-BLACK', barcode: null });
    await db.insert(variants).values({ ...base, size: 'L', colorName: 'Black', sku: 'NO-CHI-L-BLACK', barcode: null });
    expect(await db.select().from(variants)).toHaveLength(3);
  });

  it('defaults variant quantity to 0, threshold to 3, product status ACTIVE', async () => {
    const { db, product } = await fixture();
    const [v] = await db
      .insert(variants)
      .values({ productId: product.id, size: 'S', colorName: 'Black', colorHex: '#000000', sku: 'X-S-BLACK', sellPrice: 1 })
      .returning();
    expect(v).toMatchObject({ quantity: 0, lowStockThreshold: 3, isActive: true });
    expect(product.status).toBe('ACTIVE');
    expect(product.images).toEqual([]);
    expect(product.tags).toEqual([]);
  });

  it('has a trigram GIN index on products.name and unique brand names', async () => {
    const { db } = await fixture();
    const rows = (await db.execute(sql`select indexname from pg_indexes where indexname = 'products_name_trgm_idx'`)) as { rows: unknown[] };
    expect(rows.rows).toHaveLength(1);
    expect(await pgCode(db.insert(brands).values({ name: 'Northline' }))).toBe('23505');
  });

  it('stock_movements references variants and keeps qty_delta sign', async () => {
    const { db, product } = await fixture();
    const [v] = await db
      .insert(variants)
      .values({ productId: product.id, size: 'S', colorName: 'Black', colorHex: '#000000', sku: 'Y-S-BLACK', sellPrice: 1 })
      .returning();
    const [m] = await db.insert(stockMovements).values({ variantId: v!.id, type: 'INITIAL', qtyDelta: -2, qtyAfter: -2, unitCost: 500 }).returning();
    expect(m).toMatchObject({ type: 'INITIAL', qtyDelta: -2, unitCost: 500, referenceKind: null, userId: null });
    expect(await pgCode(db.insert(stockMovements).values({ variantId: '00000000-0000-4000-8000-000000000000', type: 'SALE', qtyDelta: 1, qtyAfter: 1 }))).toBe('23503');
  });

  it('enforces unique supplier name and unique root category name (23505)', async () => {
    const db = getDb();
    await db.insert(suppliers).values({ name: 'Delta' });
    expect(await pgCode(db.insert(suppliers).values({ name: 'Delta' }))).toBe('23505');
    await db.insert(categories).values({ name: 'Root' });
    expect(await pgCode(db.insert(categories).values({ name: 'Root' }))).toBe('23505');
  });
});
