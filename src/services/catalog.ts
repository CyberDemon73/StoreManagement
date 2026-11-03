import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { brands, categories, products, purchases, suppliers, variants, type CategoryRow, type SupplierRow } from '@/db/schema';
import { audit, type AuditActor } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import type { Role } from '@/lib/permissions';
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

const NAME_CONSTRAINTS = new Set([
  'brands_name_unique',
  'suppliers_name_unique',
  'categories_name_parent_unique',
  'categories_root_name_unique',
]);

function pgError(err: unknown): { code?: string; constraint?: string } | undefined {
  const cause = (err instanceof Error ? err.cause : undefined) as { code?: string; constraint?: string } | undefined;
  return cause?.code ? cause : (err as { code?: string; constraint?: string } | undefined);
}

function conflict(): AppError {
  return new AppError('CONFLICT', 'A record with this name already exists', { fields: { name: 'Already exists' } });
}

/** Run a write, turning a unique violation on a catalogue name constraint into a 409 on `name`. */
async function mapUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code === '23505') {
      if (pg.constraint && NAME_CONSTRAINTS.has(pg.constraint)) throw conflict();
      throw new AppError('CONFLICT', 'Already exists');
    }
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

/** One grouped query: ACTIVE product count and count of active variants of ACTIVE products. */
async function brandsWithCounts(db: Db, where?: SQL): Promise<BrandOut[]> {
  const rows = await db
    .select({
      brand: brands,
      productCount: activeProductCount,
      variantCount: sql<number>`count(distinct ${variants.id}) filter (where ${products.status} = 'ACTIVE' and ${variants.isActive})`.mapWith(
        Number,
      ),
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
  const id = await db.transaction(async (tx) => {
    const [row] = await mapUnique(() => tx.insert(brands).values(input).returning());
    if (!row) throw new Error('brand insert returned no row');
    await audit(tx, actor(user, ctx), 'brand.create', 'brand', row.id, null, row);
    return row.id;
  });
  return getBrand(db, id);
}

export async function patchBrand(db: Db, user: AuthUser, id: string, patch: BrandPatch, ctx: ReqCtx): Promise<BrandOut> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(brands).where(eq(brands.id, id)).limit(1);
    if (!before) throw notFound('Brand');
    const [after] = await mapUnique(() =>
      tx
        .update(brands)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(brands.id, id))
        .returning(),
    );
    if (!after) throw notFound('Brand');
    await audit(tx, actor(user, ctx), 'brand.update', 'brand', id, before, after);
  });
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

// Friendly pre-check; the DB (categories_name_parent_unique + categories_root_name_unique) is the authority.
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
  const id = await db.transaction(async (tx) => {
    await assertParentExists(tx, input.parentId);
    await assertCategoryNameFree(tx, input.name, input.parentId ?? null);
    const [row] = await mapUnique(() => tx.insert(categories).values(input).returning());
    if (!row) throw new Error('category insert returned no row');
    await audit(tx, actor(user, ctx), 'category.create', 'category', row.id, null, row);
    return row.id;
  });
  return getCategory(db, id);
}

const MAX_CATEGORY_DEPTH = 50;

function cycleError(): AppError {
  return new AppError('VALIDATION', 'Invalid input', { fields: { parentId: 'Would create a cycle' } });
}

/** Walk up from `parentId`; reaching `id` means re-parenting would create a cycle. */
async function assertNoCycle(db: Db, id: string, parentId: string): Promise<void> {
  let current: string | null = parentId;
  for (let hops = 0; current; hops++) {
    if (current === id || hops >= MAX_CATEGORY_DEPTH) throw cycleError();
    const [row]: { parentId: string | null }[] = await db
      .select({ parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, current))
      .limit(1);
    current = row?.parentId ?? null;
  }
}

export async function patchCategory(
  db: Db,
  user: AuthUser,
  id: string,
  patch: CategoryPatch,
  ctx: ReqCtx,
): Promise<CategoryOut> {
  await db.transaction(async (tx) => {
    const [before]: (CategoryRow | undefined)[] = await tx.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!before) throw notFound('Category');
    const parentId = patch.parentId !== undefined ? patch.parentId : before.parentId;
    if (parentId === id) {
      throw new AppError('VALIDATION', 'Invalid input', { fields: { parentId: 'A category cannot be its own parent' } });
    }
    if (patch.parentId) {
      await assertParentExists(tx, patch.parentId);
      await assertNoCycle(tx, id, patch.parentId);
    }
    if (patch.name !== undefined || patch.parentId !== undefined) {
      await assertCategoryNameFree(tx, patch.name ?? before.name, parentId, id);
    }
    const [after] = await mapUnique(() =>
      tx
        .update(categories)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(categories.id, id))
        .returning(),
    );
    if (!after) throw notFound('Category');
    await audit(tx, actor(user, ctx), 'category.update', 'category', id, before, after);
  });
  return getCategory(db, id);
}

// ---------- suppliers ----------

// A freshly created or patched supplier is returned without re-querying; the list carries real counts.
const NO_PURCHASES = { purchaseCount: 0, lastPurchaseAt: null } as const;

// Friendly pre-check; suppliers_name_unique is the authority.
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

/** One grouped query: purchase count and latest receivedAt per supplier (no N+1). */
export async function listSuppliers(db: Db): Promise<SupplierOut[]> {
  const rows = await db
    .select({
      supplier: suppliers,
      purchaseCount: sql<number>`count(${purchases.id})::int`.mapWith(Number),
      lastPurchaseAt: sql<string | null>`max(${purchases.receivedAt})`,
    })
    .from(suppliers)
    .leftJoin(purchases, eq(purchases.supplierId, suppliers.id))
    .groupBy(suppliers.id)
    .orderBy(asc(suppliers.name));
  return rows.map((r) =>
    toSupplier(r.supplier, {
      purchaseCount: r.purchaseCount,
      lastPurchaseAt: r.lastPurchaseAt == null ? null : new Date(r.lastPurchaseAt).toISOString(),
    }),
  );
}

export async function createSupplier(db: Db, user: AuthUser, input: SupplierInput, ctx: ReqCtx): Promise<SupplierOut> {
  return db.transaction(async (tx) => {
    await assertSupplierNameFree(tx, input.name);
    const [row] = await mapUnique(() => tx.insert(suppliers).values(input).returning());
    if (!row) throw new Error('supplier insert returned no row');
    await audit(tx, actor(user, ctx), 'supplier.create', 'supplier', row.id, null, row);
    return toSupplier(row, NO_PURCHASES);
  });
}

export async function patchSupplier(
  db: Db,
  user: AuthUser,
  id: string,
  patch: SupplierPatch,
  ctx: ReqCtx,
): Promise<SupplierOut> {
  return db.transaction(async (tx) => {
    const [before]: (SupplierRow | undefined)[] = await tx.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
    if (!before) throw notFound('Supplier');
    if (patch.name !== undefined) await assertSupplierNameFree(tx, patch.name, id);
    const [after] = await mapUnique(() =>
      tx
        .update(suppliers)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(suppliers.id, id))
        .returning(),
    );
    if (!after) throw notFound('Supplier');
    await audit(tx, actor(user, ctx), 'supplier.update', 'supplier', id, before, after);
    return toSupplier(after, NO_PURCHASES);
  });
}

export type SellerSupplierOut = Omit<SupplierOut, 'phone' | 'notes'>;

/** SELLERs may see suppliers but not their contact details or internal notes. */
export function toSupplierForRole(supplier: SupplierOut, role: Role): SupplierOut | SellerSupplierOut {
  if (role !== 'SELLER') return supplier;
  const rest: Partial<SupplierOut> = { ...supplier };
  delete rest.phone;
  delete rest.notes;
  return rest as SellerSupplierOut;
}
