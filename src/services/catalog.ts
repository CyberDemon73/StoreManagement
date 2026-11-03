import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { brands, categories, products, suppliers, variants, type CategoryRow, type SupplierRow } from '@/db/schema';
import { audit, type AuditActor } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import type { BrandInput, BrandPatch, CategoryInput, CategoryPatch, SupplierInput, SupplierPatch } from '@/schemas/catalog';
import {
  toBrand,
  toCategory,
  toSupplier,
  type BrandOut,
  type CategoryOut,
  type SupplierOut,
} from '@/serializers/catalog';

function actor(user: AuthUser, ctx: ReqCtx): AuditActor {
  return { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent };
}

function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err.cause as { code?: unknown } | undefined)?.code ?? (err as { code?: unknown }).code;
  return code === '23505';
}

function conflict(): AppError {
  return new AppError('CONFLICT', 'A record with this name already exists', { fields: { name: 'Already exists' } });
}

/** Run a write, turning a unique-constraint violation into a 409 on `name`. */
async function mapUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict();
    throw err;
  }
}

function notFound(entity: string): AppError {
  return new AppError('NOT_FOUND', `${entity} not found`);
}

const activeProductCount = sql<number>`count(distinct ${products.id}) filter (where ${products.status} = 'ACTIVE')`.mapWith(
  Number,
);

// ---------- brands ----------

/** One grouped query: ACTIVE product count and variant count (across all of the brand's products). */
async function brandsWithCounts(db: Db, where?: SQL): Promise<BrandOut[]> {
  const rows = await db
    .select({
      brand: brands,
      productCount: activeProductCount,
      variantCount: sql<number>`count(${variants.id})`.mapWith(Number),
    })
    .from(brands)
    .leftJoin(products, eq(products.brandId, brands.id))
    .leftJoin(variants, eq(variants.productId, products.id))
    .where(where)
    .groupBy(brands.id)
    .orderBy(asc(brands.name));
  return rows.map((r) => toBrand(r.brand, { productCount: r.productCount, variantCount: r.variantCount }));
}

async function getBrand(db: Db, id: string): Promise<BrandOut> {
  const [out] = await brandsWithCounts(db, eq(brands.id, id));
  if (!out) throw notFound('Brand');
  return out;
}

export function listBrands(db: Db): Promise<BrandOut[]> {
  return brandsWithCounts(db);
}

export async function createBrand(db: Db, user: AuthUser, input: BrandInput, ctx: ReqCtx): Promise<BrandOut> {
  const [row] = await mapUnique(() => db.insert(brands).values(input).returning());
  if (!row) throw new Error('brand insert returned no row');
  await audit(db, actor(user, ctx), 'brand.create', 'brand', row.id, null, row);
  return getBrand(db, row.id);
}

export async function patchBrand(db: Db, user: AuthUser, id: string, patch: BrandPatch, ctx: ReqCtx): Promise<BrandOut> {
  const [before] = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
  if (!before) throw notFound('Brand');
  const [after] = await mapUnique(() =>
    db
      .update(brands)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(brands.id, id))
      .returning(),
  );
  await audit(db, actor(user, ctx), 'brand.update', 'brand', id, before, after);
  return getBrand(db, id);
}

// ---------- categories ----------

async function categoriesWithCounts(db: Db, where?: SQL): Promise<CategoryOut[]> {
  const rows = await db
    .select({ category: categories, productCount: activeProductCount })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .where(where)
    .groupBy(categories.id)
    .orderBy(asc(categories.name));
  return rows.map((r) => toCategory(r.category, { productCount: r.productCount }));
}

async function getCategory(db: Db, id: string): Promise<CategoryOut> {
  const [out] = await categoriesWithCounts(db, eq(categories.id, id));
  if (!out) throw notFound('Category');
  return out;
}

async function assertParentExists(db: Db, parentId: string | null | undefined): Promise<void> {
  if (!parentId) return;
  const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, parentId)).limit(1);
  if (!row) throw notFound('Parent category');
}

// The (name, parent_id) unique constraint treats NULL parents as distinct, so root-level
// duplicates would slip past the database; check explicitly.
async function assertCategoryNameFree(db: Db, name: string, parentId: string | null, exceptId?: string): Promise<void> {
  const conds = [eq(categories.name, name), parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId)];
  if (exceptId) conds.push(ne(categories.id, exceptId));
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(...conds))
    .limit(1);
  if (row) throw conflict();
}

export function listCategories(db: Db): Promise<CategoryOut[]> {
  return categoriesWithCounts(db);
}

export async function createCategory(db: Db, user: AuthUser, input: CategoryInput, ctx: ReqCtx): Promise<CategoryOut> {
  await assertParentExists(db, input.parentId);
  await assertCategoryNameFree(db, input.name, input.parentId ?? null);
  const [row] = await mapUnique(() => db.insert(categories).values(input).returning());
  if (!row) throw new Error('category insert returned no row');
  await audit(db, actor(user, ctx), 'category.create', 'category', row.id, null, row);
  return getCategory(db, row.id);
}

export async function patchCategory(
  db: Db,
  user: AuthUser,
  id: string,
  patch: CategoryPatch,
  ctx: ReqCtx,
): Promise<CategoryOut> {
  const [before]: (CategoryRow | undefined)[] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  if (!before) throw notFound('Category');
  if (patch.parentId === id) {
    throw new AppError('VALIDATION', 'Invalid input', { fields: { parentId: 'A category cannot be its own parent' } });
  }
  await assertParentExists(db, patch.parentId);
  if (patch.name !== undefined || patch.parentId !== undefined) {
    await assertCategoryNameFree(db, patch.name ?? before.name, patch.parentId ?? before.parentId, id);
  }
  const [after] = await mapUnique(() =>
    db
      .update(categories)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(categories.id, id))
      .returning(),
  );
  await audit(db, actor(user, ctx), 'category.update', 'category', id, before, after);
  return getCategory(db, id);
}

// ---------- suppliers ----------

// Purchases arrive in Sprint 2; until then every supplier has no purchase history.
const NO_PURCHASES = { purchaseCount: 0, lastPurchaseAt: null } as const;

// suppliers.name has no unique constraint, so duplicates are rejected here.
async function assertSupplierNameFree(db: Db, name: string, exceptId?: string): Promise<void> {
  const conds = [eq(suppliers.name, name)];
  if (exceptId) conds.push(ne(suppliers.id, exceptId));
  const [row] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(...conds))
    .limit(1);
  if (row) throw conflict();
}

export async function listSuppliers(db: Db): Promise<SupplierOut[]> {
  const rows = await db.select().from(suppliers).orderBy(asc(suppliers.name));
  return rows.map((r) => toSupplier(r, NO_PURCHASES));
}

export async function createSupplier(db: Db, user: AuthUser, input: SupplierInput, ctx: ReqCtx): Promise<SupplierOut> {
  await assertSupplierNameFree(db, input.name);
  const [row] = await mapUnique(() => db.insert(suppliers).values(input).returning());
  if (!row) throw new Error('supplier insert returned no row');
  await audit(db, actor(user, ctx), 'supplier.create', 'supplier', row.id, null, row);
  return toSupplier(row, NO_PURCHASES);
}

export async function patchSupplier(
  db: Db,
  user: AuthUser,
  id: string,
  patch: SupplierPatch,
  ctx: ReqCtx,
): Promise<SupplierOut> {
  const [before]: (SupplierRow | undefined)[] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!before) throw notFound('Supplier');
  if (patch.name !== undefined) await assertSupplierNameFree(db, patch.name, id);
  const [after] = await mapUnique(() =>
    db
      .update(suppliers)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(suppliers.id, id))
      .returning(),
  );
  if (!after) throw notFound('Supplier');
  await audit(db, actor(user, ctx), 'supplier.update', 'supplier', id, before, after);
  return toSupplier(after, NO_PURCHASES);
}
