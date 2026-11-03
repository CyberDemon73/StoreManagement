import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { purchaseItems, purchases, suppliers, users, type PurchaseRow } from '@/db/schema';
import { audit } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { INT4_MAX } from '@/schemas/products';
import type { PurchaseInput, PurchasesQuery } from '@/schemas/purchases';
import { toPurchase, type PurchaseItemOut, type PurchaseOut } from '@/serializers/purchases';
import type { Paginated } from './audit';
import { actorOf } from './products';
import { applyMovement, lockVariants, nextNumber } from './stock';

interface PurchaseListRow {
  purchase: PurchaseRow;
  supplierName: string | null;
  createdByName: string | null;
}

/** Items for a set of purchases in one query, keyed by purchase id; ordered by variant id (no position column) so replies are stable. */
async function itemsFor(db: Db, purchaseIds: string[]): Promise<Map<string, PurchaseItemOut[]>> {
  const map = new Map<string, PurchaseItemOut[]>();
  if (purchaseIds.length === 0) return map;
  const rows = await db
    .select({ purchaseId: purchaseItems.purchaseId, variantId: purchaseItems.variantId, qty: purchaseItems.qty, unitCost: purchaseItems.unitCost })
    .from(purchaseItems)
    .where(inArray(purchaseItems.purchaseId, purchaseIds))
    .orderBy(purchaseItems.variantId);
  for (const r of rows) {
    const list = map.get(r.purchaseId) ?? [];
    list.push({ variantId: r.variantId, qty: r.qty, unitCost: r.unitCost });
    map.set(r.purchaseId, list);
  }
  return map;
}

function selectPurchases(db: Db) {
  return db
    .select({ purchase: purchases, supplierName: suppliers.name, createdByName: users.name })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(users, eq(users.id, purchases.createdBy));
}

async function hydrate(db: Db, rows: PurchaseListRow[]): Promise<PurchaseOut[]> {
  const items = await itemsFor(
    db,
    rows.map((r) => r.purchase.id),
  );
  return rows.map((r) =>
    toPurchase(r.purchase, { supplierName: r.supplierName, createdByName: r.createdByName, items: items.get(r.purchase.id) ?? [] }),
  );
}

export async function getPurchase(db: Db, id: string): Promise<PurchaseOut> {
  const rows = await selectPurchases(db).where(eq(purchases.id, id)).limit(1);
  const [out] = await hydrate(db, rows);
  if (!out) throw new AppError('NOT_FOUND', 'Purchase not found');
  return out;
}

/** Newest receivedAt first; items for the page are loaded in one extra query. */
export async function listPurchases(db: Db, { page, pageSize }: PurchasesQuery): Promise<Paginated<PurchaseOut>> {
  const [rows, [totalRow]] = await Promise.all([
    selectPurchases(db)
      .orderBy(desc(purchases.receivedAt), desc(purchases.createdAt), desc(purchases.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int`.mapWith(Number) }).from(purchases),
  ]);
  return { data: await hydrate(db, rows), page, pageSize, total: totalRow?.total ?? 0 };
}

/**
 * Receive stock: one transaction that locks the variants (sorted), allocates PO-nnnnnn,
 * stores the document and books one PURCHASE movement per line so cost re-averages.
 */
export async function createPurchase(db: Db, user: AuthUser, input: PurchaseInput, ctx: ReqCtx): Promise<PurchaseOut> {
  const total = input.items.reduce((sum, i) => sum + i.qty * i.unitCost, 0);
  if (total > INT4_MAX) {
    throw new AppError('VALIDATION', 'Invalid input', { fields: { items: 'Purchase total out of range' } });
  }

  const id = await db.transaction(async (tx) => {
    await lockVariants(
      tx,
      input.items.map((i) => i.variantId),
    );
    if (input.supplierId) {
      const [sup] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1);
      if (!sup) throw new AppError('NOT_FOUND', 'Supplier not found');
    }

    const number = await nextNumber(tx, 'PO');
    const [row] = await tx
      .insert(purchases)
      .values({
        number,
        supplierId: input.supplierId ?? null,
        invoiceRef: input.invoiceRef ?? null,
        total,
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
        note: input.note ?? null,
        createdBy: user.id,
      })
      .returning({ id: purchases.id });
    if (!row) throw new Error('purchase insert returned no row');

    await tx.insert(purchaseItems).values(input.items.map((i) => ({ purchaseId: row.id, variantId: i.variantId, qty: i.qty, unitCost: i.unitCost })));

    const reason = input.invoiceRef ? `Purchase ${number} · ${input.invoiceRef}` : `Purchase ${number}`;
    for (const item of input.items) {
      await applyMovement(tx, {
        variantId: item.variantId,
        type: 'PURCHASE',
        qtyDelta: item.qty,
        unitCost: item.unitCost,
        reference: { kind: 'purchase', id: row.id },
        reason,
        userId: user.id,
      });
    }

    const out = await getPurchase(tx, row.id);
    await audit(tx, actorOf(user, ctx), 'purchase.create', 'purchase', row.id, null, out);
    return row.id;
  });

  return getPurchase(db, id);
}
