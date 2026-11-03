/**
 * Small helpers shared by the stock and sales screens (pure, no React).
 */
import type { AdjustmentReason, MovementReference, MovementType, ProductDetail, Variant, VariantWithProduct } from '@/types';
import type { Tone } from '@/components/ui/Badge';

export const REASONS: AdjustmentReason[] = ['DAMAGED', 'LOST', 'FOUND', 'CORRECTION', 'OTHER'];

export const MOVEMENT_TYPES: MovementType[] = ['INITIAL', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT'];
export const MOVEMENT_TONE: Record<MovementType, Tone> = { INITIAL: 'accent', PURCHASE: 'ok', SALE: 'neutral', RETURN: 'info', ADJUSTMENT: 'warn' };

/** "+3" / "−2" / "0" with a true minus sign, for quantity deltas. */
export function signedQty(n: number): string {
  if (n > 0) return `+${n.toLocaleString('en-EG')}`;
  if (n < 0) return `−${Math.abs(n).toLocaleString('en-EG')}`;
  return '0';
}

/** Colour class for a delta: ok for +, danger for −, muted for 0. */
export function deltaClass(n: number): string {
  return n > 0 ? 'text-ok-ink' : n < 0 ? 'text-danger-ink' : 'text-ink-2';
}

export function variantTitle(name: string, size: string, colorName: string): string {
  return `${name} · ${size} · ${colorName}`;
}

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function localDateIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Where a movement reference points in the app. */
export function referenceHref(ref: MovementReference): string {
  switch (ref.kind) {
    case 'sale': return `/sales?open=${ref.id}`;
    case 'return': return `/sales?open=${ref.id}`;
    case 'purchase': return '/stock/receive?tab=purchases';
    case 'count': return '/stock/count';
  }
}

/** Join a product detail with one of its variants the way GET /variants/lookup does. */
export function withProductDetail(p: ProductDetail, v: Variant): VariantWithProduct {
  return { ...v, product: { id: p.id, name: p.name, baseSku: p.baseSku, images: p.images, brandName: p.brand.name, tint: p.tint } };
}

/** Build a CSV from rows and trigger a browser download. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | undefined)[][]): void {
  const esc = (v: string | number | undefined) => { const s = v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parse "sku,qty" lines (header row and blank lines ignored). */
export function parseSkuQtyCsv(text: string): { sku: string; qty: number }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).flatMap((line) => {
    const [sku = '', q = ''] = line.split(/[,;\t]/).map((s) => s.trim().replace(/^"|"$/g, ''));
    const qty = parseInt(q, 10);
    if (!sku || !Number.isFinite(qty) || /^sku$/i.test(sku)) return [];
    return [{ sku, qty }];
  });
}
