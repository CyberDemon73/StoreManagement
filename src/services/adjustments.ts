import type { Db } from '@/db/client';
import { audit } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import type { AdjustmentsInput } from '@/schemas/movements';
import type { StockMovementOut } from '@/serializers/movements';
import { loadMovements } from './movements';
import { notifyLowStock } from './notifications';
import { actorOf } from './products';
import { applyMovement, lockVariants } from './stock';

/**
 * Book every item as an ADJUSTMENT ledger row in one transaction. `newQty` is resolved against
 * the running quantity (earlier items in the same request count), and zero deltas are skipped so
 * a "no change" correction never produces a ledger row.
 */
export async function createAdjustments(db: Db, user: AuthUser, input: AdjustmentsInput, ctx: ReqCtx): Promise<StockMovementOut[]> {
  const ids = await db.transaction(async (tx) => {
    const locked = await lockVariants(
      tx,
      input.items.map((i) => i.variantId),
    );
    const running = new Map([...locked].map(([id, v]) => [id, v.quantity]));
    const created: string[] = [];
    const booked: { variantId: string; qtyDelta: number; reason: string }[] = [];
    for (const item of input.items) {
      const current = running.get(item.variantId) ?? 0;
      const delta = item.newQty !== undefined ? item.newQty - current : (item.qtyDelta ?? 0);
      if (delta === 0) continue;
      const result = await applyMovement(tx, {
        variantId: item.variantId,
        type: 'ADJUSTMENT',
        qtyDelta: delta,
        reason: item.note ? `${item.reason}: ${item.note}` : item.reason,
        userId: user.id,
      });
      running.set(item.variantId, result.quantity);
      created.push(result.movementId);
      booked.push({ variantId: item.variantId, qtyDelta: delta, reason: item.reason });
    }
    // Only decreases alert: restocking a still-low variant must not re-raise a read alert.
    await notifyLowStock(
      tx,
      booked.filter((b) => b.qtyDelta < 0).map((b) => b.variantId),
    );
    if (created.length > 0) await audit(tx, actorOf(user, ctx), 'stock.adjust', 'variant', null, null, { items: booked });
    return created;
  });
  return loadMovements(db, ids);
}
