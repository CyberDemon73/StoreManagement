import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { alias } from 'drizzle-orm/pg-core';
import { products, purchases, returns, sales, stockCounts, stockMovements, users, variants } from '@/db/schema';
import type { MovementsQuery } from '@/schemas/movements';
import { toMovement, type MovementJoinedRow, type StockMovementOut } from '@/serializers/movements';
import type { Paginated } from './audit';
import { escapeLike } from './products-list';

// A return's label is the number of the sale it refunds, so `sales` is joined twice.
const returnSales = alias(sales, 'return_sales');

const movementFields = {
  id: stockMovements.id,
  variantId: stockMovements.variantId,
  type: stockMovements.type,
  qtyDelta: stockMovements.qtyDelta,
  qtyAfter: stockMovements.qtyAfter,
  unitCost: stockMovements.unitCost,
  referenceKind: stockMovements.referenceKind,
  referenceId: stockMovements.referenceId,
  reason: stockMovements.reason,
  userId: stockMovements.userId,
  userName: users.name,
  createdAt: stockMovements.createdAt,
  size: variants.size,
  colorName: variants.colorName,
  colorHex: variants.colorHex,
  sku: variants.sku,
  productName: products.name,
  purchaseNumber: purchases.number,
  countNumber: stockCounts.number,
  saleNumber: sales.number,
  returnSaleNumber: returnSales.number,
};

/** Ledger ⋈ variants ⋈ products, left ⋈ users and the documents a reference can point at. */
function joined<E extends Record<string, SQL>>(db: Db, extra: E) {
  return db
    .select({ ...movementFields, ...extra })
    .from(stockMovements)
    .innerJoin(variants, eq(variants.id, stockMovements.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .leftJoin(users, eq(users.id, stockMovements.userId))
    .leftJoin(purchases, and(eq(stockMovements.referenceKind, 'purchase'), eq(purchases.id, stockMovements.referenceId)))
    .leftJoin(stockCounts, and(eq(stockMovements.referenceKind, 'count'), eq(stockCounts.id, stockMovements.referenceId)))
    .leftJoin(sales, and(eq(stockMovements.referenceKind, 'sale'), eq(sales.id, stockMovements.referenceId)))
    .leftJoin(returns, and(eq(stockMovements.referenceKind, 'return'), eq(returns.id, stockMovements.referenceId)))
    .leftJoin(returnSales, eq(returnSales.id, returns.saleId));
}

const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);

export async function listMovements(db: Db, query: MovementsQuery): Promise<Paginated<StockMovementOut>> {
  const { page, pageSize, variantId, productId, type, from, to, userId, q } = query;
  const where: SQL[] = [];
  if (variantId) where.push(eq(stockMovements.variantId, variantId));
  if (productId) where.push(eq(variants.productId, productId));
  if (type) where.push(eq(stockMovements.type, type));
  if (userId) where.push(eq(stockMovements.userId, userId));
  if (from) where.push(gte(stockMovements.createdAt, dayStart(from)));
  // `to` is inclusive: everything before the start of the following day.
  if (to) where.push(lt(stockMovements.createdAt, new Date(dayStart(to).getTime() + 86_400_000)));
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(sql`(${variants.sku} ilike ${like} escape '\\' or ${products.name} ilike ${like} escape '\\')`);
  }
  const whereExpr = where.length ? and(...where) : undefined;

  const rows = await joined(db, { total: sql<number>`count(*) over()::int` })
    .where(whereExpr)
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.seq))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Past the last page the window count has no row to ride on — count separately.
  let total = rows[0]?.total ?? 0;
  if (rows.length === 0 && page > 1) {
    const [c] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(stockMovements)
      .innerJoin(variants, eq(variants.id, stockMovements.variantId))
      .innerJoin(products, eq(products.id, variants.productId))
      .where(whereExpr);
    total = c?.n ?? 0;
  }

  return { data: rows.map((r) => toMovement(r as MovementJoinedRow)), page, pageSize, total };
}

/** The given movements (in the order of `ids`), serialized like the ledger listing. */
export async function loadMovements(db: Db, ids: string[]): Promise<StockMovementOut[]> {
  if (ids.length === 0) return [];
  const rows = await joined(db, {}).where(inArray(stockMovements.id, ids));
  const byId = new Map(rows.map((r) => [r.id, toMovement(r as MovementJoinedRow)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
