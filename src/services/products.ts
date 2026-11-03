import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { brands, categories, products, variants, type ProductRow, type VariantRow } from '@/db/schema';
import { audit, type AuditActor } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { buildSku, defaultBaseSku, skuPart } from '@/lib/sku';
import type { ProductCreateInput, ProductPatchInput, VariantMatrixInput } from '@/schemas/products';
import {
  toProduct,
  toProductDetail,
  toVariant,
  type ProductAggregates,
  type ProductDetailOut,
  type VariantOut,
} from '@/serializers/catalog';
import { getSettings } from './settings';
import { applyMovement } from './stock';

/** withAuth({ permission }) always supplies a user; this narrows the type and guards misuse. */
export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return user;
}

export function actorOf(user: AuthUser, ctx: ReqCtx): AuditActor {
  return { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent };
}

const UNIQUE_FIELDS: Record<string, { field: string; message: string }> = {
  products_base_sku_unique: { field: 'baseSku', message: 'Base SKU already exists' },
  variants_sku_unique: { field: 'sku', message: 'SKU already exists' },
  variants_barcode_unique: { field: 'barcode', message: 'Barcode already exists' },
  variants_product_size_color_unique: { field: 'variants', message: 'Variant already exists for this size and colour' },
};

/**
 * Turn a Postgres unique violation (23505) into a 409 CONFLICT naming the field; anything else is
 * rethrown untouched. Drizzle wraps the driver error, so the pg details live on `err.cause`.
 */
export function mapUniqueViolation(err: unknown): never {
  const cause = (err instanceof Error ? err.cause : undefined) as { code?: string; constraint?: string } | undefined;
  const pg = cause?.code ? cause : (err as { code?: string; constraint?: string } | undefined);
  if (pg?.code === '23505') {
    const hit = pg.constraint ? UNIQUE_FIELDS[pg.constraint] : undefined;
    if (hit) throw new AppError('CONFLICT', hit.message, { fields: { [hit.field]: hit.message } });
    throw new AppError('CONFLICT', 'Already exists');
  }
  throw err;
}

/**
 * Aggregate over ACTIVE variants, shared by the product list (lateral join) and the detail view.
 * Every count is cast to int so each driver (PGlite, node-postgres) returns numbers, not
 * bigint/strings. Aliased so the fields can live inside a subquery.
 */
export const variantAggregateFields = {
  variantCount: sql<number>`count(*)::int`.as('variant_count'),
  totalQty: sql<number>`coalesce(sum(${variants.quantity}), 0)::int`.as('total_qty'),
  lowCount: sql<number>`count(*) filter (where ${variants.quantity} > 0 and ${variants.quantity} <= ${variants.lowStockThreshold})::int`.as('low_count'),
  outCount: sql<number>`count(*) filter (where ${variants.quantity} <= 0)::int`.as('out_count'),
  minPrice: sql<number | null>`min(${variants.sellPrice})::int`.as('min_price'),
  maxPrice: sql<number | null>`max(${variants.sellPrice})::int`.as('max_price'),
  tint: sql<string | null>`(array_agg(${variants.colorHex} order by ${variants.createdAt}, ${variants.id}))[1]`.as('tint'),
};

export function toAggregates(row: Partial<ProductAggregates> | undefined): ProductAggregates {
  return {
    variantCount: row?.variantCount ?? 0,
    totalQty: row?.totalQty ?? 0,
    lowCount: row?.lowCount ?? 0,
    outCount: row?.outCount ?? 0,
    minPrice: row?.minPrice ?? null,
    maxPrice: row?.maxPrice ?? null,
    tint: row?.tint ?? null,
  };
}

export async function productAggregates(db: Db, productId: string): Promise<ProductAggregates> {
  const [row] = await db
    .select(variantAggregateFields)
    .from(variants)
    .where(and(eq(variants.productId, productId), eq(variants.isActive, true)));
  return toAggregates(row);
}

async function loadProduct(db: Db, id: string): Promise<ProductRow> {
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Product not found');
  return row;
}

async function assertBrand(db: Db, id: string): Promise<{ id: string; name: string }> {
  const [row] = await db.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Brand not found', { fields: { brandId: 'Brand not found' } });
  return row;
}

async function assertCategory(db: Db, id: string): Promise<void> {
  const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Category not found', { fields: { categoryId: 'Category not found' } });
}

export async function createProduct(db: Db, user: AuthUser, input: ProductCreateInput, ctx: ReqCtx): Promise<ProductDetailOut> {
  const { variants: matrix, ...fields } = input;
  const id = await db.transaction(async (tx) => {
    // Inactive brands/categories are still valid references (archiving must not break products).
    const brand = await assertBrand(tx, fields.brandId);
    await assertCategory(tx, fields.categoryId);
    const baseSku = fields.baseSku ?? defaultBaseSku(brand.name, fields.name);
    let product: ProductRow | undefined;
    try {
      [product] = await tx
        .insert(products)
        .values({ ...fields, baseSku, createdBy: user.id })
        .returning();
    } catch (err) {
      mapUniqueViolation(err);
    }
    if (!product) throw new Error('product insert returned no row');
    const created = matrix ? await addVariantsTx(tx, user, product, matrix) : [];
    await audit(tx, actorOf(user, ctx), 'product.create', 'product', product.id, null, {
      ...toProduct(product),
      variants: created.map((v) => ({ id: v.id, sku: v.sku, quantity: v.quantity })),
    });
    return product.id;
  });
  const detail = await getProductDetail(db, id);
  if (!detail) throw new Error('created product not found');
  return detail;
}

/**
 * Insert every size×colour cell that does not exist yet and book its initial stock through the
 * ledger. Must run inside the caller's transaction. Returns only the cells created here.
 */
export async function addVariantsTx(tx: Db, user: AuthUser, product: ProductRow, matrix: VariantMatrixInput): Promise<VariantOut[]> {
  const existing = await tx
    .select({ size: variants.size, colorName: variants.colorName })
    .from(variants)
    .where(eq(variants.productId, product.id));
  const taken = new Set(existing.map((e) => `${e.size}|${e.colorName}`));

  // Validate the whole matrix before touching the DB: a size like "!!!" strips to an empty SKU
  // part, and "M"/"m" or "S-M"/"SM" collide into the same SKU although they are distinct cells.
  const seenSkus = new Set<string>();
  for (const size of matrix.sizes) {
    for (const color of matrix.colors) {
      if (!skuPart(size) || !skuPart(color.name)) {
        throw new AppError('VALIDATION', 'Invalid variant matrix', { fields: { variants: `Size "${size}" or colour "${color.name}" has no letters or digits for the SKU` } });
      }
      const sku = buildSku(product.baseSku, size, color.name);
      if (seenSkus.has(sku)) {
        throw new AppError('VALIDATION', 'Invalid variant matrix', { fields: { variants: `Two cells produce the same SKU ${sku}` } });
      }
      seenSkus.add(sku);
    }
  }

  const { lowStockDefault } = await getSettings(tx);
  const sellPrice = matrix.sellPrice ?? product.defaultPrice;
  const costPrice = matrix.costPrice ?? product.defaultCost ?? null;

  const out: VariantOut[] = [];
  for (const size of matrix.sizes) {
    for (const color of matrix.colors) {
      const key = `${size}|${color.name}`;
      if (taken.has(key)) continue;
      taken.add(key);
      let row: VariantRow | undefined;
      try {
        // clock_timestamp(): now() is frozen for the whole transaction, and the matrix order
        // (size-major, then colour) is what detail/tint ordering relies on.
        [row] = await tx
          .insert(variants)
          .values({
            productId: product.id,
            size,
            colorName: color.name,
            colorHex: color.hex,
            sku: buildSku(product.baseSku, size, color.name),
            sellPrice,
            costPrice,
            lowStockThreshold: lowStockDefault,
            createdAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
          })
          .returning();
      } catch (err) {
        mapUniqueViolation(err);
      }
      if (!row) throw new Error('variant insert returned no row');
      const qty = typeof matrix.initialQty === 'number' ? matrix.initialQty : (matrix.initialQty?.[key] ?? 0);
      if (qty > 0) {
        const moved = await applyMovement(tx, {
          variantId: row.id,
          type: 'INITIAL',
          qtyDelta: qty,
          unitCost: costPrice,
          reason: 'Initial stock',
          userId: user.id,
        });
        row = { ...row, quantity: moved.quantity, costPrice: moved.costPrice };
      }
      out.push(toVariant(row));
    }
  }
  return out;
}

export async function getProductDetail(db: Db, id: string): Promise<ProductDetailOut | null> {
  const [row] = await db
    .select({ product: products, brand: { id: brands.id, name: brands.name }, category: { id: categories.id, name: categories.name } })
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.id, id))
    .limit(1);
  if (!row) return null;
  const [agg, variantRows] = await Promise.all([
    productAggregates(db, id),
    // Matrix order (size-major, then colour) = insertion order; see addVariantsTx.
    db.select().from(variants).where(eq(variants.productId, id)).orderBy(asc(variants.createdAt), asc(variants.id)),
  ]);
  return toProductDetail(row.product, { brand: row.brand, category: row.category }, agg, variantRows);
}

export async function patchProduct(db: Db, user: AuthUser, id: string, patch: ProductPatchInput, ctx: ReqCtx): Promise<ProductDetailOut> {
  await db.transaction(async (tx) => {
    const before = await loadProduct(tx, id);
    if (patch.brandId && patch.brandId !== before.brandId) await assertBrand(tx, patch.brandId);
    if (patch.categoryId && patch.categoryId !== before.categoryId) await assertCategory(tx, patch.categoryId);
    let after: ProductRow | undefined;
    try {
      // A baseSku change deliberately leaves existing variant SKUs alone (they may be on labels).
      [after] = await tx
        .update(products)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();
    } catch (err) {
      mapUniqueViolation(err);
    }
    if (!after) throw new AppError('NOT_FOUND', 'Product not found');
    await audit(tx, actorOf(user, ctx), 'product.update', 'product', id, toProduct(before), toProduct(after));
  });
  const detail = await getProductDetail(db, id);
  if (!detail) throw new AppError('NOT_FOUND', 'Product not found');
  return detail;
}

export async function setProductStatus(db: Db, user: AuthUser, id: string, status: 'ACTIVE' | 'ARCHIVED', ctx: ReqCtx): Promise<ProductDetailOut> {
  await db.transaction(async (tx) => {
    const before = await loadProduct(tx, id);
    // Idempotent: re-archiving an archived product changes nothing and writes no audit row.
    if (before.status === status) return;
    const [after] = await tx
      .update(products)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(products.id, id), eq(products.status, before.status)))
      .returning();
    if (!after) throw new AppError('NOT_FOUND', 'Product not found');
    const action = status === 'ARCHIVED' ? 'product.archive' : 'product.unarchive';
    await audit(tx, actorOf(user, ctx), action, 'product', id, { status: before.status }, { status: after.status });
  });
  const detail = await getProductDetail(db, id);
  if (!detail) throw new AppError('NOT_FOUND', 'Product not found');
  return detail;
}
