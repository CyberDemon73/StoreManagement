import type { PurchaseRow } from '@/db/schema';

// Mirrors the frontend's src/types.ts Purchase / PurchaseItem.

export interface PurchaseItemOut {
  variantId: string;
  qty: number;
  /** Cost field: stripped for sellers by forRole (they cannot reach these routes anyway). */
  unitCost: number;
}

export interface PurchaseOut {
  id: string;
  number: string;
  supplierId?: string;
  supplierName?: string;
  invoiceRef?: string;
  items: PurchaseItemOut[];
  lineCount: number;
  unitCount: number;
  total: number;
  receivedAt: string;
  /** Empty string when the creating user was deleted. */
  createdBy: string;
  createdByName: string;
  note?: string;
}

export interface PurchaseJoins {
  supplierName: string | null;
  createdByName: string | null;
  items: PurchaseItemOut[];
}

export function toPurchase(row: PurchaseRow, joins: PurchaseJoins): PurchaseOut {
  const out: PurchaseOut = {
    id: row.id,
    number: row.number,
    items: joins.items,
    lineCount: joins.items.length,
    unitCount: joins.items.reduce((sum, i) => sum + i.qty, 0),
    total: row.total,
    receivedAt: row.receivedAt.toISOString(),
    createdBy: row.createdBy ?? '',
    createdByName: joins.createdByName ?? '—',
  };
  if (row.supplierId) out.supplierId = row.supplierId;
  if (joins.supplierName) out.supplierName = joins.supplierName;
  if (row.invoiceRef) out.invoiceRef = row.invoiceRef;
  if (row.note) out.note = row.note;
  return out;
}
