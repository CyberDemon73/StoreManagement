import type { ReturnItemRow, ReturnRow, SaleItemRow, SaleRow } from '@/db/schema';
import type { ColorRef } from './catalog';

// Shapes mirror the frontend's src/types.ts Sale / SaleItem / Return / ParkedSale.

export interface SaleItemOut {
  id: string;
  variantId: string;
  productName: string;
  size: string;
  color: ColorRef;
  sku: string;
  tint: string;
  qty: number;
  unitPrice: number;
  /** Snapshot at sale time. Hidden for sellers. */
  unitCost?: number;
  lineTotal: number;
  returnedQty: number;
}

export interface ReturnOut {
  id: string;
  saleId: string;
  items: { saleItemId: string; qty: number; restock: boolean }[];
  refundAmount: number;
  refundMethod: string;
  reason: string;
  note?: string;
  createdBy: string;
  createdAt: string;
}

export interface SaleOut {
  id: string;
  number: string;
  sellerId: string;
  sellerName: string;
  items: SaleItemOut[];
  subtotal: number;
  discount: number;
  discountPct?: number;
  total: number;
  paymentMethod: string;
  status: 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOID';
  customerName?: string;
  customerPhone?: string;
  note?: string;
  /** Hidden for sellers. */
  cost?: number;
  /** Hidden for sellers. */
  profit?: number;
  returns: ReturnOut[];
  voidReason?: string;
  createdAt: string;
}

export interface ParkedSaleOut {
  id: string;
  cart: unknown;
  parkedAt: string;
  label: string;
}

export interface SaleItemJoin {
  item: SaleItemRow;
  productName: string;
  size: string;
  colorName: string;
  colorHex: string;
  sku: string;
  tint: string | null;
}

function omitNullish<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out as T;
}

export function toSaleItem(j: SaleItemJoin): SaleItemOut {
  return omitNullish({
    id: j.item.id,
    variantId: j.item.variantId,
    productName: j.productName,
    size: j.size,
    color: { name: j.colorName, hex: j.colorHex },
    sku: j.sku,
    tint: j.tint ?? '#E6E3DC',
    qty: j.item.qty,
    unitPrice: j.item.unitPrice,
    unitCost: j.item.unitCost,
    lineTotal: j.item.lineTotal,
    returnedQty: j.item.returnedQty,
  }) as SaleItemOut;
}

export function toReturn(row: ReturnRow, items: ReturnItemRow[]): ReturnOut {
  return omitNullish({
    id: row.id,
    saleId: row.saleId,
    items: items.map((i) => ({ saleItemId: i.saleItemId, qty: i.qty, restock: i.restock })),
    refundAmount: row.refundAmount,
    refundMethod: row.refundMethod,
    reason: row.reason,
    note: row.note,
    createdBy: row.createdBy ?? '',
    createdAt: row.createdAt.toISOString(),
  }) as ReturnOut;
}

/** Full sale. `cost`/`profit` are included (manager fields) and stripped for sellers by forRole. */
export function toSale(row: SaleRow, sellerName: string | null, items: SaleItemOut[], returnsOut: ReturnOut[]): SaleOut {
  const costKnown = items.every((i) => typeof i.unitCost === 'number');
  const cost = costKnown ? items.reduce((s, i) => s + (i.unitCost ?? 0) * i.qty, 0) : undefined;
  const refunded = returnsOut.reduce((s, r) => s + r.refundAmount, 0);
  return omitNullish({
    id: row.id,
    number: row.number,
    sellerId: row.sellerId ?? '',
    sellerName: sellerName ?? '—',
    items,
    subtotal: row.subtotal,
    discount: row.discount,
    discountPct: row.discountPct == null ? undefined : Number(row.discountPct),
    total: row.total,
    paymentMethod: row.paymentMethod,
    status: row.status,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    note: row.note,
    cost,
    profit: cost === undefined ? undefined : row.total - refunded - cost,
    returns: returnsOut,
    voidReason: row.voidReason,
    createdAt: row.createdAt.toISOString(),
  }) as SaleOut;
}
