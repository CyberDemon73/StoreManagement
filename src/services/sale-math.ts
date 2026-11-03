// Pure money math for sales. All values are integer minor units.

export interface TotalsInput {
  lines: { unitPrice: number; qty: number }[];
  discount?: { type: 'PCT' | 'AMOUNT'; value: number };
}

export interface Totals {
  subtotal: number;
  discount: number;
  /** The percentage when the discount was given as PCT, else null. */
  discountPct: number | null;
  total: number;
}

export function computeTotals(input: TotalsInput): Totals {
  const subtotal = input.lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  let discount = 0;
  let discountPct: number | null = null;
  if (input.discount) {
    if (input.discount.type === 'PCT') {
      discountPct = input.discount.value;
      discount = Math.round((subtotal * input.discount.value) / 100);
    } else {
      discount = Math.round(input.discount.value);
    }
  }
  discount = Math.max(0, Math.min(discount, subtotal));
  return { subtotal, discount, discountPct, total: subtotal - discount };
}

/** Sellers may discount at most `capPct` of the subtotal (settings.sellerDiscountCapPct). */
export function sellerCapExceeded(totals: Totals, capPct: number): boolean {
  return totals.discount > Math.round((totals.subtotal * capPct) / 100);
}

/** A returned line refunds its share of what was actually paid after the sale-level discount. */
export function lineRefund(unitPrice: number, qty: number, subtotal: number, total: number): number {
  if (subtotal <= 0) return 0;
  return Math.round((unitPrice * qty * total) / subtotal);
}
