import type { ColorRef } from './catalog';

// Mirrors src/types.ts StockMovement (userId is nullable server-side: users can be deleted).

export type MovementReferenceKind = 'sale' | 'purchase' | 'return' | 'count';

export interface StockMovementOut {
  id: string;
  variantId: string;
  variant: { size: string; color: ColorRef; sku: string; productName: string };
  type: 'INITIAL' | 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT';
  qtyDelta: number;
  qtyAfter: number;
  /** Hidden for sellers. */
  unitCost?: number;
  reference?: { kind: MovementReferenceKind; id: string; label: string };
  reason?: string;
  userId: string | null;
  userName: string;
  createdAt: string;
}

/** Flat row as selected by services/movements.ts (joins already resolved). */
export interface MovementJoinedRow {
  id: string;
  variantId: string;
  type: StockMovementOut['type'];
  qtyDelta: number;
  qtyAfter: number;
  unitCost: number | null;
  referenceKind: MovementReferenceKind | null;
  referenceId: string | null;
  reason: string | null;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
  size: string;
  colorName: string;
  colorHex: string;
  sku: string;
  productName: string;
  purchaseNumber: string | null;
  countNumber: string | null;
  saleNumber: string | null;
  returnSaleNumber: string | null;
}

export function toMovement(r: MovementJoinedRow): StockMovementOut {
  const out: StockMovementOut = {
    id: r.id,
    variantId: r.variantId,
    variant: { size: r.size, color: { name: r.colorName, hex: r.colorHex }, sku: r.sku, productName: r.productName },
    type: r.type,
    qtyDelta: r.qtyDelta,
    qtyAfter: r.qtyAfter,
    userId: r.userId,
    userName: r.userName ?? '—',
    createdAt: r.createdAt.toISOString(),
  };
  if (r.unitCost !== null) out.unitCost = r.unitCost;
  if (r.reason !== null) out.reason = r.reason;
  if (r.referenceKind !== null && r.referenceId !== null) {
    const labels: Record<MovementReferenceKind, string | null> = {
      purchase: r.purchaseNumber,
      count: r.countNumber,
      sale: r.saleNumber,
      return: r.returnSaleNumber,
    };
    const label = labels[r.referenceKind];
    out.reference = { kind: r.referenceKind, id: r.referenceId, label: label ?? r.referenceId };
  }
  return out;
}
