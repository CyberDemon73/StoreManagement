import type { StockCountItemRow, StockCountRow } from '@/db/schema';
import type { ColorRef } from './catalog';

// Mirrors the frontend's StockCount / StockCountItem (src/types.ts); the backend never imports that file.

export interface StockCountItemOut {
  variantId: string;
  variant: { size: string; color: ColorRef; sku: string; costPrice?: number; productName: string };
  systemQty: number;
  countedQty: number | null;
  countedBy?: string;
  countedAt?: string;
}

export interface StockCountOut {
  id: string;
  number: string;
  status: 'OPEN' | 'APPLIED' | 'CANCELLED';
  scope: string;
  /** Empty string when the starting user was deleted. */
  startedBy: string;
  startedByName: string;
  startedAt: string;
  appliedAt?: string;
  /** Distinct names of the users who recorded counts. */
  counters: string[];
  items: StockCountItemOut[];
}

export interface CountItemVariantRef {
  size: string;
  colorName: string;
  colorHex: string;
  sku: string;
  costPrice: number | null;
  productName: string;
}

export function toStockCountItem(row: StockCountItemRow, variant: CountItemVariantRef): StockCountItemOut {
  const out: StockCountItemOut = {
    variantId: row.variantId,
    variant: { size: variant.size, color: { name: variant.colorName, hex: variant.colorHex }, sku: variant.sku, productName: variant.productName },
    systemQty: row.systemQty,
    countedQty: row.countedQty,
  };
  if (variant.costPrice != null) out.variant.costPrice = variant.costPrice;
  if (row.countedBy) out.countedBy = row.countedBy;
  if (row.countedAt) out.countedAt = row.countedAt.toISOString();
  return out;
}

export function toStockCount(row: StockCountRow, startedByName: string | null, counters: string[], items: StockCountItemOut[]): StockCountOut {
  const out: StockCountOut = {
    id: row.id,
    number: row.number,
    status: row.status,
    scope: row.scope,
    startedBy: row.startedBy ?? '',
    startedByName: startedByName ?? '—',
    startedAt: row.startedAt.toISOString(),
    counters,
    items,
  };
  if (row.appliedAt) out.appliedAt = row.appliedAt.toISOString();
  return out;
}
