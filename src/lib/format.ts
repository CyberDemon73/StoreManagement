import type { DateRange, DateRangePreset, StockStatus } from '@/types';

/**
 * Display formatting only. Money arrives as integer minor units and is never
 * computed with floats here beyond dividing for display.
 */

const DEFAULT_CURRENCY = 'EGP';

export interface MoneyOptions {
  /** Prefix the currency code ("EGP 1,250.00"). Default false → "1,250.00". */
  withCurrency?: boolean;
  /** Drop the fraction when it is .00 and the value is large (KPI tiles). */
  compact?: boolean;
  /** Prefix a sign for deltas. */
  signed?: boolean;
}

export function formatMoney(minor: number, currency: string = DEFAULT_CURRENCY, opts: MoneyOptions = {}): string {
  const abs = Math.abs(minor);
  const major = Math.trunc(abs / 100);
  const cents = abs % 100;
  const majorStr = major.toLocaleString('en-EG');
  let body = opts.compact && (cents === 0 || abs >= 10_000_00) ? majorStr : `${majorStr}.${String(cents).padStart(2, '0')}`;
  if (opts.withCurrency) body = `${currency} ${body}`;
  if (minor < 0) return `−${body}`;
  if (opts.signed && minor > 0) return `+${body}`;
  return body;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-EG');
}

export function formatPct(pct: number, digits = 1, signed = false): string {
  const s = `${Math.abs(pct).toFixed(digits)}%`;
  if (pct < 0) return `−${s}`;
  return signed && pct > 0 ? `+${s}` : s;
}

/** Percentage of `part` over `whole`, safe for zero. */
export function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

export function marginPct(price: number, cost: number | undefined): number | undefined {
  if (cost === undefined || price === 0) return undefined;
  return ((price - cost) / price) * 100;
}

const DAY_MS = 86_400_000;

export function formatDate(iso: string, format: 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'short' = 'short'): string {
  const d = new Date(iso);
  if (format === 'YYYY-MM-DD') return d.toISOString().slice(0, 10);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  if (format === 'DD/MM/YYYY') return `${dd}/${mm}/${d.getFullYear()}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today ${formatTime(iso)}`;
  const yesterday = new Date(now.getTime() - DAY_MS);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${formatTime(iso)}`;
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

export function formatRelativeDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function stockStatus(qty: number, threshold: number): StockStatus {
  if (qty <= 0) return 'out';
  if (qty <= threshold) return 'low';
  return 'ok';
}

export function stockStatusLabel(s: StockStatus): string {
  return s === 'out' ? 'Out of stock' : s === 'low' ? 'Low stock' : 'In stock';
}

export const PAYMENT_LABEL: Record<string, string> = { CASH: 'Cash', CARD: 'Card', WALLET: 'Wallet', TRANSFER: 'Transfer' };

export const SALE_STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Completed',
  PARTIALLY_REFUNDED: 'Partially refunded',
  REFUNDED: 'Refunded',
  VOID: 'Void',
};

export const MOVEMENT_LABEL: Record<string, string> = {
  INITIAL: 'Initial',
  PURCHASE: 'Purchase',
  SALE: 'Sale',
  RETURN: 'Return',
  ADJUSTMENT: 'Adjustment',
};

export const REASON_LABEL: Record<string, string> = {
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  FOUND: 'Found',
  CORRECTION: 'Correction',
  OTHER: 'Other',
};

/* ---------- Date ranges ---------- */

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shortDay(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function dateRangeFor(preset: DateRangePreset, now = new Date(), custom?: { from: string; to: string }): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (offset: number) => new Date(today.getTime() + offset * DAY_MS);
  switch (preset) {
    case 'today':
      return { preset, from: isoDay(today), to: isoDay(today), label: `Today, ${shortDay(today)} ${today.getFullYear()}` };
    case 'yesterday': {
      const y = day(-1);
      return { preset, from: isoDay(y), to: isoDay(y), label: `Yesterday, ${shortDay(y)}` };
    }
    case '7d': {
      const f = day(-6);
      return { preset, from: isoDay(f), to: isoDay(today), label: `Last 7 days · ${shortDay(f)} – ${shortDay(today)}` };
    }
    case '30d': {
      const f = day(-29);
      return { preset, from: isoDay(f), to: isoDay(today), label: `Last 30 days · ${shortDay(f)} – ${shortDay(today)}` };
    }
    case 'month': {
      const f = new Date(today.getFullYear(), today.getMonth(), 1);
      return { preset, from: isoDay(f), to: isoDay(today), label: `This month · ${f.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}` };
    }
    case 'lastMonth': {
      const f = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const t = new Date(today.getFullYear(), today.getMonth(), 0);
      return { preset, from: isoDay(f), to: isoDay(t), label: `Last month · ${f.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}` };
    }
    case 'custom': {
      const from = custom?.from ?? isoDay(day(-13));
      const to = custom?.to ?? isoDay(today);
      return { preset, from, to, label: `Custom · ${shortDay(new Date(from))} – ${shortDay(new Date(to))}` };
    }
  }
}

export const DATE_PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'custom', label: 'Custom…' },
];

/** Deterministic soft tint for a colour hex (used as placeholder image backgrounds). */
export function tintFor(hex: string): string {
  return hex;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
