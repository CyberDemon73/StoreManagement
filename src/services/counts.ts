import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { products, stockCountItems, stockCounts, users, variants, type StockCountRow } from '@/db/schema';
import { audit } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import type { CountApplyInput, CountItemsInput, CountStartInput } from '@/schemas/counts';
import { toStockCount, toStockCountItem, type StockCountOut } from '@/serializers/counts';
import { notifyLowStock, notifyManagers } from './notifications';
import { actorOf } from './products';
import { applyMovement, lockVariants, nextNumber } from './stock';

/** The list endpoint embeds items (the frontend's StockCount requires them), so it is capped to bound the payload. */
export const LIST_LIMIT = 20;

type Tx = Db;

const counterName = sql<string | null>`${users.name}`;

async function loadItems(db: Db, countIds: string[]) {
  if (countIds.length === 0) return new Map<string, { item: StockCountOut['items'][number]; counter: string | null }[]>();
  const rows = await db
    .select({
      item: stockCountItems,
      variant: { size: variants.size, colorName: variants.colorName, colorHex: variants.colorHex, sku: variants.sku, costPrice: variants.costPrice, productName: products.name },
      counter: counterName,
    })
    .from(stockCountItems)
    .innerJoin(variants, eq(variants.id, stockCountItems.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .leftJoin(users, eq(users.id, stockCountItems.countedBy))
    .where(inArray(stockCountItems.countId, countIds))
    .orderBy(asc(products.name), asc(variants.size), asc(variants.id));
  const byCount = new Map<string, { item: StockCountOut['items'][number]; counter: string | null }[]>();
  for (const r of rows) {
    const list = byCount.get(r.item.countId) ?? [];
    list.push({ item: toStockCountItem(r.item, r.variant), counter: r.counter });
    byCount.set(r.item.countId, list);
  }
  return byCount;
}

async function serializeCounts(db: Db, rows: { count: StockCountRow; startedByName: string | null }[]): Promise<StockCountOut[]> {
  const items = await loadItems(
    db,
    rows.map((r) => r.count.id),
  );
  return rows.map((r) => {
    const entries = items.get(r.count.id) ?? [];
    const counters = [...new Set(entries.map((e) => e.counter).filter((n): n is string => !!n))];
    return toStockCount(
      r.count,
      r.startedByName,
      counters,
      entries.map((e) => e.item),
    );
  });
}

function selectCounts(db: Db) {
  return db
    .select({ count: stockCounts, startedByName: sql<string | null>`${users.name}` })
    .from(stockCounts)
    .leftJoin(users, eq(users.id, stockCounts.startedBy));
}

export async function getCount(db: Db, id: string): Promise<StockCountOut> {
  const rows = await selectCounts(db).where(eq(stockCounts.id, id)).limit(1);
  const [out] = await serializeCounts(db, rows);
  if (!out) throw new AppError('NOT_FOUND', 'Stock count not found');
  return out;
}

/** Newest first, capped at LIST_LIMIT because each count carries its items. */
export async function listCounts(db: Db): Promise<StockCountOut[]> {
  const rows = await selectCounts(db).orderBy(desc(stockCounts.startedAt), desc(stockCounts.id)).limit(LIST_LIMIT);
  return serializeCounts(db, rows);
}

/** Locks the count row so concurrent apply/cancel/patch calls serialize on its status. */
async function lockOpenCount(tx: Tx, id: string): Promise<StockCountRow> {
  const locked = (await tx.execute(sql`select id from stock_counts where id = ${id} for update`)) as { rows: { id: string }[] };
  if (!locked.rows[0]) throw new AppError('NOT_FOUND', 'Stock count not found');
  const [row] = await tx.select().from(stockCounts).where(eq(stockCounts.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Stock count not found');
  if (row.status !== 'OPEN') throw new AppError('CONFLICT', `Stock count is ${row.status}`);
  return row;
}

/** Snapshot the current quantity of every active variant in scope under a fresh SC number. */
export async function startCount(db: Db, user: AuthUser, input: CountStartInput, ctx: ReqCtx): Promise<StockCountOut> {
  const id = await db.transaction(async (tx) => {
    const number = await nextNumber(tx, 'SC');
    const [count] = await tx.insert(stockCounts).values({ number, scope: input.scope, startedBy: user.id }).returning();
    if (!count) throw new Error('stock count insert returned no row');

    const where = [eq(variants.isActive, true), eq(products.status, 'ACTIVE')];
    if (input.productIds && input.productIds.length > 0) where.push(inArray(products.id, input.productIds));
    const snapshot = await tx
      .select({ variantId: variants.id, quantity: variants.quantity })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(and(...where))
      .orderBy(asc(products.name), asc(variants.size), asc(variants.id));
    if (snapshot.length > 0) {
      await tx.insert(stockCountItems).values(snapshot.map((v) => ({ countId: count.id, variantId: v.variantId, systemQty: v.quantity })));
    }
    await audit(tx, actorOf(user, ctx), 'count.start', 'stock_count', count.id, null, {
      number,
      scope: input.scope,
      productIds: input.productIds ?? null,
      itemCount: snapshot.length,
    });
    return count.id;
  });
  return getCount(db, id);
}

/** Record counted quantities on an OPEN count; every variant must belong to the count. */
export async function saveCountItems(db: Db, user: AuthUser, id: string, input: CountItemsInput, ctx: ReqCtx): Promise<StockCountOut> {
  await db.transaction(async (tx) => {
    await lockOpenCount(tx, id);
    const known = new Set((await tx.select({ variantId: stockCountItems.variantId }).from(stockCountItems).where(eq(stockCountItems.countId, id))).map((r) => r.variantId));
    const fields: Record<string, string> = {};
    input.items.forEach((item, i) => {
      if (!known.has(item.variantId)) fields[`items.${i}.variantId`] = 'Variant is not part of this count';
    });
    if (Object.keys(fields).length > 0) throw new AppError('VALIDATION', 'Unknown variant for this count', { fields });

    const now = new Date();
    // Last write for a repeated variant wins, as in the request order.
    for (const item of input.items) {
      await tx
        .update(stockCountItems)
        .set({ countedQty: item.countedQty, countedBy: user.id, countedAt: now })
        .where(and(eq(stockCountItems.countId, id), eq(stockCountItems.variantId, item.variantId)));
    }
    await audit(tx, actorOf(user, ctx), 'count.update', 'stock_count', id, null, { items: input.items });
  });
  return getCount(db, id);
}

/**
 * Turn the variance into ADJUSTMENT movements. The delta is computed against the live quantity
 * at apply time (not the snapshot), so stock that moved after the snapshot is not adjusted twice.
 */
export async function applyCount(db: Db, user: AuthUser, id: string, input: CountApplyInput, ctx: ReqCtx): Promise<StockCountOut> {
  await db.transaction(async (tx) => {
    const count = await lockOpenCount(tx, id);
    const items = await tx.select().from(stockCountItems).where(eq(stockCountItems.countId, id)).orderBy(asc(stockCountItems.id));
    const targets = items
      .filter((i) => i.countedQty != null || input.uncountedAsZero)
      .map((i) => ({ variantId: i.variantId, countedQty: i.countedQty ?? 0 }));
    const live = await lockVariants(
      tx,
      targets.map((t) => t.variantId),
    );
    // Re-check eligibility under the lock: variants deactivated (or products archived) since the snapshot are skipped.
    const eligibleRows =
      targets.length === 0
        ? []
        : await tx
            .select({ id: variants.id })
            .from(variants)
            .innerJoin(products, eq(products.id, variants.productId))
            .where(
              and(
                inArray(
                  variants.id,
                  targets.map((t) => t.variantId),
                ),
                eq(variants.isActive, true),
                eq(products.status, 'ACTIVE'),
              ),
            );
    const eligible = new Set(eligibleRows.map((r) => r.id));
    const skipped: string[] = [];
    let movements = 0;
    const moved: string[] = [];
    for (const t of targets) {
      if (!eligible.has(t.variantId)) {
        skipped.push(t.variantId);
        continue;
      }
      const current = live.get(t.variantId);
      if (!current) throw new AppError('NOT_FOUND', 'Variant not found');
      const delta = t.countedQty - current.quantity;
      if (delta === 0) continue;
      const result = await applyMovement(tx, {
        variantId: t.variantId,
        type: 'ADJUSTMENT',
        qtyDelta: delta,
        reference: { kind: 'count', id },
        reason: `Stock count ${count.number}`,
        userId: user.id,
      });
      live.set(t.variantId, { quantity: result.quantity, costPrice: result.costPrice });
      movements += 1;
      moved.push(t.variantId);
    }
    await notifyLowStock(tx, moved);
    await notifyManagers(tx, {
      kind: 'COUNT_APPLIED',
      title: 'Stock count applied',
      body: `${count.number} applied by ${user.name} · ${movements} adjustments.`,
      href: '/stock/count',
      payload: { countId: id, movements },
    });
    const now = new Date();
    await tx.update(stockCounts).set({ status: 'APPLIED', appliedAt: now, appliedBy: user.id }).where(eq(stockCounts.id, id));
    await audit(tx, actorOf(user, ctx), 'count.apply', 'stock_count', id, { status: 'OPEN' }, { status: 'APPLIED', uncountedAsZero: !!input.uncountedAsZero, movements, skipped });
  });
  return getCount(db, id);
}

export async function cancelCount(db: Db, user: AuthUser, id: string, ctx: ReqCtx): Promise<StockCountOut> {
  await db.transaction(async (tx) => {
    await lockOpenCount(tx, id);
    await tx.update(stockCounts).set({ status: 'CANCELLED' }).where(eq(stockCounts.id, id));
    await audit(tx, actorOf(user, ctx), 'count.cancel', 'stock_count', id, { status: 'OPEN' }, { status: 'CANCELLED' });
  });
  return getCount(db, id);
}
