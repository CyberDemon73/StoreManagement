import { and, asc, count, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { brands, products, stockMovements, variants, type VariantRow } from '@/db/schema';
import { audit } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import type { VariantLookupQuery, VariantMatrixInput, VariantPatchInput } from '@/schemas/products';
import { toVariant, toVariantWithProduct, type VariantOut, type VariantWithProductOut } from '@/serializers/catalog';
import { escapeLike } from './products-list';
import { actorOf, addVariantsTx, mapUniqueViolation } from './products';

async function assertProduct(db: Db, productId: string) {
  const [row] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Product not found');
  return row;
}

async function loadVariant(db: Db, id: string): Promise<VariantRow> {
  const [row] = await db.select().from(variants).where(eq(variants.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Variant not found');
  return row;
}

/** Matrix order (insertion order), the same as the product detail. */
export async function listProductVariants(db: Db, productId: string): Promise<VariantOut[]> {
  await assertProduct(db, productId);
  const rows = await db.select().from(variants).where(eq(variants.productId, productId)).orderBy(asc(variants.createdAt), asc(variants.id));
  return rows.map(toVariant);
}

/** Adds the missing size×colour cells (with INITIAL stock); returns only the newly created ones. */
export async function addVariants(db: Db, user: AuthUser, productId: string, matrix: VariantMatrixInput, ctx: ReqCtx): Promise<VariantOut[]> {
  return db.transaction(async (tx) => {
    const product = await assertProduct(tx, productId);
    const created = await addVariantsTx(tx, user, product, matrix);
    if (created.length > 0) {
      await audit(tx, actorOf(user, ctx), 'variant.create', 'product', productId, null, {
        variants: created.map((v) => ({ id: v.id, sku: v.sku, quantity: v.quantity })),
      });
    }
    return created;
  });
}

/** Prices, threshold, barcode, SKU and active flag only; quantity is the ledger's (schema rejects it). */
export async function patchVariant(db: Db, user: AuthUser, id: string, patch: VariantPatchInput, ctx: ReqCtx): Promise<VariantOut> {
  return db.transaction(async (tx) => {
    const before = await loadVariant(tx, id);
    let after: VariantRow | undefined;
    try {
      [after] = await tx
        .update(variants)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(variants.id, id))
        .returning();
    } catch (err) {
      mapUniqueViolation(err);
    }
    if (!after) throw new AppError('NOT_FOUND', 'Variant not found');
    await audit(tx, actorOf(user, ctx), 'variant.update', 'variant', id, toVariant(before), toVariant(after));
    return toVariant(after);
  });
}

/** Hard delete is allowed only for a cell that never touched the ledger; otherwise deactivate it. */
export async function deleteVariant(db: Db, user: AuthUser, id: string, ctx: ReqCtx): Promise<void> {
  await db.transaction(async (tx) => {
    // Lock the row so a concurrent applyMovement cannot slip a ledger row in between the check and the delete.
    await tx.execute(sql`select 1 from variants where id = ${id} for update`);
    const before = await loadVariant(tx, id);
    const [m] = await tx.select({ n: count() }).from(stockMovements).where(eq(stockMovements.variantId, id));
    if (before.quantity !== 0 || (m?.n ?? 0) > 0) {
      throw new AppError('CONFLICT', 'Variant has stock or movements');
    }
    try {
      await tx.delete(variants).where(eq(variants.id, id));
    } catch (err) {
      // FK restrict from stock_movements (23503): a movement landed anyway → conflict, not 500.
      if ((err as { cause?: { code?: string } }).cause?.code === '23503') {
        throw new AppError('CONFLICT', 'Variant has stock or movements');
      }
      throw err;
    }
    await audit(tx, actorOf(user, ctx), 'variant.delete', 'variant', id, toVariant(before), null);
  });
}

// First colour of the product's active variants, the same rule as the list/detail aggregate.
const productTint = sql<string | null>`(
  select v2.color_hex from variants v2
  where v2.product_id = ${products.id} and v2.is_active
  order by v2.created_at, v2.id limit 1)`;

function selectWithProduct(db: Db) {
  return db
    .select({
      variant: variants,
      product: { id: products.id, name: products.name, baseSku: products.baseSku, images: products.images, brandName: brands.name, tint: productTint },
    })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .innerJoin(brands, eq(brands.id, products.brandId));
}

/** Scanner path: exact barcode and/or case-insensitive SKU. Archived products stay scannable. */
export async function lookupVariant(db: Db, query: VariantLookupQuery): Promise<VariantWithProductOut | null> {
  const where: SQL[] = [];
  if (query.barcode) where.push(eq(variants.barcode, query.barcode));
  if (query.sku) where.push(sql`lower(${variants.sku}) = lower(${query.sku})`);
  const [row] = await selectWithProduct(db).where(and(...where)).limit(1);
  return row ? toVariantWithProduct(row.variant, row.product) : null;
}

/** Quick picker for the POS: SKU / product-name contains, or exact barcode, over ACTIVE products. */
export async function searchVariants(db: Db, q: string, limit: number): Promise<VariantWithProductOut[]> {
  const like = `%${escapeLike(q)}%`;
  const rows = await selectWithProduct(db)
    .where(
      and(
        eq(products.status, 'ACTIVE'),
        sql`(${variants.sku} ilike ${like} escape '\\' or ${variants.barcode} = ${q} or ${products.name} ilike ${like} escape '\\')`,
      ),
    )
    .orderBy(asc(variants.sku))
    .limit(limit);
  return rows.map((r) => toVariantWithProduct(r.variant, r.product));
}
