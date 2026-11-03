import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { returnItems, returns, saleItems, sales } from '@/db/schema';
import { audit } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import type { ReturnInput } from '@/schemas/sales';
import { toReturn, type SaleOut } from '@/serializers/sales';
import { actorOf } from './products';
import { lineRefund } from './sale-math';
import { lockSale } from './sale-void';
import { loadSale } from './sales';
import { applyMovement, lockVariants } from './stock';

/**
 * Partial or full return of a sale. One transaction: lock the sale, validate every line against
 * what is still returnable, refund each line's share of what was actually paid, book RETURN
 * movements (at the sale-time cost snapshot) for restocked lines, and roll the sale status.
 * Sellers may only return their own sales; a foreign sale reads as 404 so nothing leaks.
 */
export async function createReturn(db: Db, user: AuthUser, saleId: string, input: ReturnInput, ctx: ReqCtx): Promise<SaleOut> {
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, saleId);
    if (!sale || (user.role === 'SELLER' && sale.sellerId !== user.id)) throw new AppError('NOT_FOUND', 'Sale not found');
    if (sale.status === 'VOID') throw new AppError('CONFLICT', 'Sale is void');

    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, saleId));
    const byId = new Map(items.map((i) => [i.id, i]));

    // Lines may repeat a sale item: validate the running total per item, naming the first line that overflows.
    const fields: Record<string, string> = {};
    const perItem = new Map<string, number>();
    input.items.forEach((line, i) => {
      const item = byId.get(line.saleItemId);
      if (!item) {
        fields[`items.${i}.saleItemId`] = 'Not an item of this sale';
        return;
      }
      const remaining = item.qty - item.returnedQty;
      const sum = (perItem.get(line.saleItemId) ?? 0) + line.qty;
      perItem.set(line.saleItemId, sum);
      if (sum > remaining && !fields[`items.${i}.qty`]) fields[`items.${i}.qty`] = `Only ${remaining} returnable`;
    });
    if (Object.keys(fields).length > 0) throw new AppError('VALIDATION', 'Some lines cannot be returned', { fields });

    let refundAmount = 0;
    for (const [saleItemId, qty] of perItem) {
      const item = byId.get(saleItemId)!;
      refundAmount += lineRefund(item.unitPrice, qty, sale.subtotal, sale.total);
    }

    const [ret] = await tx
      .insert(returns)
      .values({ saleId, refundAmount, refundMethod: input.refundMethod, reason: input.reason, note: input.note || null, createdBy: user.id })
      .returning();
    if (!ret) throw new Error('return insert returned no row');
    const retItems = await tx
      .insert(returnItems)
      .values(input.items.map((l) => ({ returnId: ret.id, saleItemId: l.saleItemId, qty: l.qty, restock: l.restock })))
      .returning();

    for (const [saleItemId, qty] of perItem) {
      await tx
        .update(saleItems)
        .set({ returnedQty: sql`${saleItems.returnedQty} + ${qty}` })
        .where(eq(saleItems.id, saleItemId));
    }

    // Restock per variant (aggregated) so the ledger has one row per variant per return.
    const restock = new Map<string, { qty: number; unitCost: number | null }>();
    for (const l of input.items) {
      if (!l.restock) continue;
      const item = byId.get(l.saleItemId)!;
      const cur = restock.get(item.variantId);
      restock.set(item.variantId, { qty: (cur?.qty ?? 0) + l.qty, unitCost: cur?.unitCost ?? item.unitCost });
    }
    if (restock.size > 0) {
      await lockVariants(tx, [...restock.keys()]);
      for (const [variantId, r] of restock) {
        await applyMovement(tx, {
          variantId,
          type: 'RETURN',
          qtyDelta: r.qty,
          unitCost: r.unitCost,
          reference: { kind: 'return', id: ret.id },
          reason: `Return ${sale.number}`,
          userId: user.id,
        });
      }
    }

    const fullyReturned = items.every((i) => i.returnedQty + (perItem.get(i.id) ?? 0) === i.qty);
    await tx
      .update(sales)
      .set({ status: fullyReturned ? 'REFUNDED' : 'PARTIALLY_REFUNDED' })
      .where(eq(sales.id, saleId));

    await audit(tx, actorOf(user, ctx), 'return.create', 'return', ret.id, null, toReturn(ret, retItems));
  });

  const out = await loadSale(db, saleId);
  if (!out) throw new Error('sale vanished after return');
  return out;
}
