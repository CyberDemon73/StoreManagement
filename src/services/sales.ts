import { and, desc, eq, exists, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { brands, products, returnItems, returns, saleItems, sales, users, variants, type SaleRow } from '@/db/schema';
import { audit } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { INT4_MAX } from '@/schemas/products';
import type { SaleCreateInput, SalesQuery } from '@/schemas/sales';
import { toReturn, toSale, toSaleItem, type SaleOut } from '@/serializers/sales';
import type { Paginated } from './audit';
import { actorOf } from './products';
import { escapeLike } from './products-list';
import { computeTotals, sellerCapExceeded } from './sale-math';
import { notifyLowStock } from './notifications';
import { getSettings } from './settings';
import { applyMovement, lockVariants, nextNumber } from './stock';
import { localDayBounds } from '@/analytics/range';

// First colour of the product's active variants (same rule as the catalogue serializers).
const productTint = sql<string | null>`(
  select v2.color_hex from variants v2
  where v2.product_id = ${products.id} and v2.is_active
  order by v2.created_at, v2.id limit 1)`;

/** Load a sale with items, seller and returns. Returns null when missing. */
export async function loadSale(db: Db, id: string): Promise<SaleOut | null> {
  const [row] = await db
    .select({ sale: sales, sellerName: users.name })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.sellerId))
    .where(eq(sales.id, id))
    .limit(1);
  if (!row) return null;
  const [sale] = await loadSalesOut(db, [row.sale], new Map([[row.sale.id, row.sellerName]]));
  return sale ?? null;
}

/** Hydrate items and returns for a page of sales in two queries. */
export async function loadSalesOut(db: Db, rows: SaleRow[], sellerNames: Map<string, string | null>): Promise<SaleOut[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const itemRows = await db
    .select({
      item: saleItems,
      productName: products.name,
      size: variants.size,
      colorName: variants.colorName,
      colorHex: variants.colorHex,
      sku: variants.sku,
      tint: productTint,
      brand: brands.name,
    })
    .from(saleItems)
    .innerJoin(variants, eq(variants.id, saleItems.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .innerJoin(brands, eq(brands.id, products.brandId))
    .where(inArray(saleItems.saleId, ids))
    // sale_items ids are random UUIDs; sku gives receipts and the UI a stable line order.
    .orderBy(variants.sku, saleItems.id);
  const returnRows = await db.select().from(returns).where(inArray(returns.saleId, ids)).orderBy(returns.createdAt, returns.id);
  const returnItemRows =
    returnRows.length === 0
      ? []
      : await db
          .select()
          .from(returnItems)
          .where(
            inArray(
              returnItems.returnId,
              returnRows.map((r) => r.id),
            ),
          );

  return rows.map((row) => {
    const items = itemRows.filter((i) => i.item.saleId === row.id).map(toSaleItem);
    const rets = returnRows
      .filter((r) => r.saleId === row.id)
      .map((r) =>
        toReturn(
          r,
          returnItemRows.filter((ri) => ri.returnId === r.id),
        ),
      );
    return toSale(row, sellerNames.get(row.id) ?? null, items, rets);
  });
}

interface Line {
  variantId: string;
  qty: number;
  unitPrice: number;
  unitCost: number | null;
}

/**
 * POS checkout. One transaction: lock variants (sorted), validate availability for the
 * aggregated quantities, recompute every amount server-side, allocate the number, snapshot
 * price and cost per line, book SALE movements, audit.
 */
export async function createSale(db: Db, user: AuthUser, input: SaleCreateInput, ctx: ReqCtx): Promise<SaleOut> {
  const wantsOverride = input.items.some((i) => i.unitPrice !== undefined);
  if (wantsOverride && !can(user, 'sales.price.override')) {
    throw new AppError('FORBIDDEN', 'Changing the unit price requires the price override permission');
  }

  const saleId = await db.transaction(async (tx) => {
    const settings = await getSettings(tx);
    const ids = [...new Set(input.items.map((i) => i.variantId))];
    const locked = await lockVariants(tx, ids);

    const rows = await tx
      .select({ id: variants.id, sellPrice: variants.sellPrice, costPrice: variants.costPrice, isActive: variants.isActive, productStatus: products.status })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(inArray(variants.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));

    const unavailable: Record<string, string> = {};
    for (const id of ids) {
      const v = byId.get(id);
      if (!v || !v.isActive || v.productStatus !== 'ACTIVE') unavailable[id] = 'Not available for sale';
    }
    if (Object.keys(unavailable).length > 0) throw new AppError('CONFLICT', 'Some items are not available for sale', { fields: unavailable });

    // Aggregate per variant so two lines of the same SKU are checked against stock once.
    const requested = new Map<string, number>();
    for (const i of input.items) requested.set(i.variantId, (requested.get(i.variantId) ?? 0) + i.qty);
    if (!settings.allowNegativeStock) {
      const short: Record<string, string> = {};
      for (const [id, qty] of requested) {
        const have = locked.get(id)?.quantity ?? 0;
        if (have < qty) short[id] = `Only ${have} available`;
      }
      if (Object.keys(short).length > 0) throw new AppError('INSUFFICIENT_STOCK', 'Some items are no longer in stock', { fields: short });
    }

    const lines: Line[] = input.items.map((i) => {
      const v = byId.get(i.variantId)!;
      return { variantId: i.variantId, qty: i.qty, unitPrice: i.unitPrice ?? v.sellPrice, unitCost: v.costPrice };
    });
    const totals = computeTotals({ lines, discount: input.discount });
    // Money columns are int4: refuse out-of-range baskets up front instead of failing in the INSERT.
    if (totals.subtotal > INT4_MAX || lines.some((l) => l.unitPrice * l.qty > INT4_MAX)) {
      throw new AppError('VALIDATION', 'Sale total is out of range', { fields: { items: 'Total exceeds the supported range' } });
    }
    if (!can(user, 'sales.discount.unlimited') && sellerCapExceeded(totals, Number(settings.sellerDiscountCapPct))) {
      throw new AppError('VALIDATION', 'Discount exceeds your allowed cap', {
        fields: { discount: `Sellers may discount at most ${Number(settings.sellerDiscountCapPct)} %` },
      });
    }

    const number = await nextNumber(tx, settings.saleNumberPrefix);
    const [sale] = await tx
      .insert(sales)
      .values({
        number,
        sellerId: user.id,
        subtotal: totals.subtotal,
        discount: totals.discount,
        discountPct: totals.discountPct == null ? null : String(totals.discountPct),
        total: totals.total,
        paymentMethod: input.paymentMethod,
        customerName: input.customerName || null,
        customerPhone: input.customerPhone || null,
        note: input.note || null,
      })
      .returning();
    if (!sale) throw new Error('sale insert returned no row');

    await tx.insert(saleItems).values(
      lines.map((l) => ({ saleId: sale.id, variantId: l.variantId, qty: l.qty, unitPrice: l.unitPrice, unitCost: l.unitCost, lineTotal: l.unitPrice * l.qty })),
    );

    for (const [variantId, qty] of requested) {
      await applyMovement(tx, { variantId, type: 'SALE', qtyDelta: -qty, reference: { kind: 'sale', id: sale.id }, reason: `Sale ${number}`, userId: user.id });
    }
    await notifyLowStock(tx, [...requested.keys()]);

    const out = await loadSale(tx, sale.id);
    await audit(tx, actorOf(user, ctx), 'sale.create', 'sale', sale.id, null, out);
    return sale.id;
  });

  const out = await loadSale(db, saleId);
  if (!out) throw new Error('sale vanished after commit');
  return out;
}

/** Sale visible to this user: managers see all, sellers only their own. Null otherwise. */
export async function getSale(db: Db, user: AuthUser, id: string): Promise<SaleOut | null> {
  const own = user.role === 'SELLER' ? eq(sales.sellerId, user.id) : undefined;
  const [row] = await db
    .select({ id: sales.id })
    .from(sales)
    .where(own ? and(eq(sales.id, id), own) : eq(sales.id, id))
    .limit(1);
  if (!row) return null;
  return loadSale(db, id);
}

/** Newest first. Sellers only ever see their own sales; a foreign `sellerId` is refused. */
export async function listSales(db: Db, user: AuthUser, query: SalesQuery): Promise<Paginated<SaleOut>> {
  const { page, pageSize, from, to, paymentMethod, status, q, productId } = query;
  let sellerId = query.sellerId;
  if (user.role === 'SELLER') {
    if (sellerId && sellerId !== user.id) throw new AppError('FORBIDDEN', 'Sellers can only list their own sales');
    sellerId = user.id;
  }

  const where: SQL[] = [];
  if (sellerId) where.push(eq(sales.sellerId, sellerId));
  if (paymentMethod) where.push(eq(sales.paymentMethod, paymentMethod));
  if (status) where.push(eq(sales.status, status));
  // Local days in the store timezone; `to` is inclusive (CLAUDE.md rule 8).
  const bounds = await localDayBounds(db, from, to);
  if (bounds.start) where.push(sql`${sales.createdAt} >= ${bounds.start}`);
  if (bounds.end) where.push(sql`${sales.createdAt} < ${bounds.end}`);
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      sql`(${sales.number} ilike ${like} escape '\\'
        or ${sales.customerName} ilike ${like} escape '\\'
        or ${sales.customerPhone} ilike ${like} escape '\\')`,
    );
  }
  if (productId) {
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(saleItems)
          .innerJoin(variants, eq(variants.id, saleItems.variantId))
          .where(and(eq(saleItems.saleId, sales.id), eq(variants.productId, productId))),
      ),
    );
  }
  const whereExpr = where.length ? and(...where) : undefined;

  const rows = await db
    .select({ sale: sales, sellerName: users.name, total: sql<number>`count(*) over()::int` })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.sellerId))
    .where(whereExpr)
    .orderBy(desc(sales.createdAt), desc(sales.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Past the last page the window count has no row to ride on — count separately.
  let total = rows[0]?.total ?? 0;
  if (rows.length === 0 && page > 1) {
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(sales).where(whereExpr);
    total = c?.n ?? 0;
  }

  const data = await loadSalesOut(
    db,
    rows.map((r) => r.sale),
    new Map(rows.map((r) => [r.sale.id, r.sellerName])),
  );
  return { data, page, pageSize, total };
}
