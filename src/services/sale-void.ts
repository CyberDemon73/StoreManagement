import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { returns, saleItems, sales, type SaleRow } from '@/db/schema';
import { audit } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import type { VoidInput } from '@/schemas/sales';
import type { SaleOut } from '@/serializers/sales';
import { actorOf } from './products';
import { loadSale } from './sales';
import { applyMovement, lockVariants } from './stock';

/** Lock the sale row for the rest of the transaction so concurrent voids/returns serialise. */
export async function lockSale(tx: Db, id: string): Promise<SaleRow | null> {
  const [row] = await tx.select().from(sales).where(eq(sales.id, id)).for('update');
  return row ?? null;
}

/**
 * Void a sale: stock comes back through ADJUSTMENT movements for whatever was not already
 * returned. Refused once a refund has been paid out (any return) — the money is gone.
 */
export async function voidSale(db: Db, user: AuthUser, id: string, input: VoidInput, ctx: ReqCtx): Promise<SaleOut> {
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, id);
    if (!sale) throw new AppError('NOT_FOUND', 'Sale not found');
    if (sale.status === 'VOID') throw new AppError('CONFLICT', 'Sale is already void');
    const [ret] = await tx.select({ id: returns.id }).from(returns).where(eq(returns.saleId, id)).limit(1);
    if (ret) throw new AppError('CONFLICT', 'Sale has returns; refund already recorded');

    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, id));
    await lockVariants(
      tx,
      items.map((i) => i.variantId),
    );
    for (const item of items) {
      const delta = item.qty - item.returnedQty;
      if (delta === 0) continue;
      await applyMovement(tx, {
        variantId: item.variantId,
        type: 'ADJUSTMENT',
        qtyDelta: delta,
        reference: { kind: 'sale', id },
        reason: `Void ${sale.number}`,
        userId: user.id,
      });
    }

    await tx
      .update(sales)
      .set({ status: 'VOID', voidedAt: sql`now()`, voidedBy: user.id, voidReason: input.reason })
      .where(eq(sales.id, id));
    await audit(tx, actorOf(user, ctx), 'sale.void', 'sale', id, { status: sale.status }, { status: 'VOID', reason: input.reason });
  });

  const out = await loadSale(db, id);
  if (!out) throw new Error('sale vanished after void');
  return out;
}
