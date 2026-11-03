import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { settings, stockMovements } from '@/db/schema';
import { AppError } from '@/lib/errors';

export type MovementType = 'INITIAL' | 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT';

export interface MovementInput {
  variantId: string;
  type: MovementType;
  qtyDelta: number;
  unitCost?: number | null;
  reference?: { kind: 'sale' | 'purchase' | 'return' | 'count'; id: string } | null;
  reason?: string | null;
  userId: string | null;
}

export interface MovementResult {
  movementId: string;
  quantity: number;
  costPrice: number | null;
}

interface LockedRow {
  quantity: number;
  cost_price: number | null;
}

/**
 * The ONLY code path that changes variants.quantity (CLAUDE.md rule 1).
 * Call inside a transaction: locks the variant row, checks the result, appends the ledger row,
 * and updates quantity (+ weighted-average cost on incoming stock) atomically.
 */
export async function applyMovement(tx: Db, input: MovementInput): Promise<MovementResult> {
  if (!Number.isInteger(input.qtyDelta) || input.qtyDelta === 0) {
    throw new AppError('VALIDATION', 'qtyDelta must be a non-zero integer', { fields: { qtyDelta: 'Must be a non-zero integer' } });
  }

  const locked = (await tx.execute(
    sql`select quantity, cost_price from variants where id = ${input.variantId} for update`,
  )) as { rows: LockedRow[] };
  const current = locked.rows[0];
  if (!current) throw new AppError('NOT_FOUND', 'Variant not found');

  const newQty = current.quantity + input.qtyDelta;
  if (newQty > 2_147_483_647) {
    throw new AppError('VALIDATION', 'Quantity out of range', { fields: { qtyDelta: 'Out of range' } });
  }
  if (newQty < 0) {
    const [cfg] = await tx.select({ allow: settings.allowNegativeStock }).from(settings).limit(1);
    if (!cfg?.allow) {
      throw new AppError('INSUFFICIENT_STOCK', 'Insufficient stock', { fields: { [input.variantId]: 'Insufficient stock' } });
    }
  }

  // Incoming stock with a known cost re-averages; sales/returns/adjustments keep the cost.
  let costPrice = current.cost_price;
  const incoming = (input.type === 'INITIAL' || input.type === 'PURCHASE') && input.qtyDelta > 0;
  if (incoming && input.unitCost != null) {
    const oldQty = Math.max(0, current.quantity);
    costPrice =
      current.cost_price == null || oldQty === 0
        ? input.unitCost
        : Math.round((oldQty * current.cost_price + input.qtyDelta * input.unitCost) / (oldQty + input.qtyDelta));
  }

  const [movement] = await tx
    .insert(stockMovements)
    .values({
      variantId: input.variantId,
      type: input.type,
      qtyDelta: input.qtyDelta,
      qtyAfter: newQty,
      unitCost: input.unitCost ?? null,
      referenceKind: input.reference?.kind ?? null,
      referenceId: input.reference?.id ?? null,
      reason: input.reason ?? null,
      userId: input.userId,
    })
    .returning({ id: stockMovements.id });
  if (!movement) throw new Error('movement insert returned no row');

  await tx.execute(
    sql`update variants set quantity = ${newQty}, cost_price = ${costPrice}, updated_at = now() where id = ${input.variantId}`,
  );

  return { movementId: movement.id, quantity: newQty, costPrice };
}

export interface LockedVariant {
  quantity: number;
  costPrice: number | null;
}

/**
 * Lock several variant rows in one statement, in id order, so concurrent multi-variant
 * transactions (sales, purchases, counts) always acquire locks in the same sequence and
 * cannot deadlock. Call this before the first applyMovement of a transaction.
 */
export async function lockVariants(tx: Db, ids: string[]): Promise<Map<string, LockedVariant>> {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return new Map();
  const result = (await tx.execute(
    sql`select id, quantity, cost_price from variants where id = any(${sql.raw(`array[${unique.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')}]::uuid[]`)}) order by id for update`,
  )) as { rows: { id: string; quantity: number; cost_price: number | null }[] };
  const map = new Map<string, LockedVariant>();
  for (const r of result.rows) map.set(r.id, { quantity: Number(r.quantity), costPrice: r.cost_price == null ? null : Number(r.cost_price) });
  const missing = unique.filter((id) => !map.has(id));
  if (missing.length > 0) {
    throw new AppError('NOT_FOUND', 'Variant not found', { fields: Object.fromEntries(missing.map((id) => [id, 'Variant not found'])) });
  }
  return map;
}

/** Lock every variant first (sorted), then apply the movements in the given order. */
export async function applyMovements(tx: Db, inputs: MovementInput[]): Promise<MovementResult[]> {
  await lockVariants(
    tx,
    inputs.map((i) => i.variantId),
  );
  const out: MovementResult[] = [];
  for (const input of inputs) out.push(await applyMovement(tx, input));
  return out;
}

export type NumberPrefix = 'PO' | 'SC' | 'AS';

/** Allocate the next document number (e.g. PO-000001) under a row lock on sale_counters. */
export async function nextNumber(tx: Db, prefix: NumberPrefix): Promise<string> {
  await tx.execute(sql`insert into sale_counters (prefix) values (${prefix}) on conflict (prefix) do nothing`);
  const locked = (await tx.execute(sql`select next from sale_counters where prefix = ${prefix} for update`)) as { rows: { next: number }[] };
  const n = Number(locked.rows[0]?.next ?? 1);
  await tx.execute(sql`update sale_counters set next = ${n + 1} where prefix = ${prefix}`);
  return `${prefix}-${String(n).padStart(6, '0')}`;
}
