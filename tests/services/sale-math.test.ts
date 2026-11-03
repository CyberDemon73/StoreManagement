import { describe, expect, it } from 'vitest';
import { saleCreateBody } from '@/schemas/sales';
import { computeTotals, cumulativeRefund, lineRefund, sellerCapExceeded } from '@/services/sale-math';

describe('computeTotals', () => {
  const lines = [
    { unitPrice: 1000, qty: 2 },
    { unitPrice: 1000, qty: 1 },
  ];

  it('sums lines and applies a percentage discount', () => {
    expect(computeTotals({ lines, discount: { type: 'PCT', value: 10 } })).toEqual({ subtotal: 3000, discount: 300, discountPct: 10, total: 2700 });
  });

  it('applies an amount discount in minor units, capped at the subtotal', () => {
    expect(computeTotals({ lines, discount: { type: 'AMOUNT', value: 500 } })).toEqual({ subtotal: 3000, discount: 500, discountPct: null, total: 2500 });
    expect(computeTotals({ lines, discount: { type: 'AMOUNT', value: 5000 } })).toEqual({ subtotal: 3000, discount: 3000, discountPct: null, total: 0 });
  });

  it('has no discount by default and rounds percentages to whole minor units', () => {
    expect(computeTotals({ lines })).toEqual({ subtotal: 3000, discount: 0, discountPct: null, total: 3000 });
    expect(computeTotals({ lines: [{ unitPrice: 999, qty: 1 }], discount: { type: 'PCT', value: 12.5 } }).discount).toBe(125);
  });
});

describe('sellerCapExceeded', () => {
  it('is false at exactly the cap and true one minor unit above', () => {
    const at = computeTotals({ lines: [{ unitPrice: 3000, qty: 1 }], discount: { type: 'AMOUNT', value: 300 } });
    const over = computeTotals({ lines: [{ unitPrice: 3000, qty: 1 }], discount: { type: 'AMOUNT', value: 301 } });
    expect(sellerCapExceeded(at, 10)).toBe(false);
    expect(sellerCapExceeded(over, 10)).toBe(true);
  });
});

describe('lineRefund', () => {
  it('refunds the line share of what was actually paid', () => {
    expect(lineRefund(1000, 2, 3000, 2700)).toBe(1800);
    expect(lineRefund(1000, 1, 3000, 3000)).toBe(1000);
    expect(lineRefund(1000, 1, 0, 0)).toBe(0);
  });
});

describe('cumulativeRefund', () => {
  it('three one-line returns of 333/333/334 at 10 % refund exactly the 900 paid', () => {
    let refunded = 0;
    for (const after of [333, 666, 1000]) refunded += cumulativeRefund({ subtotal: 1000, total: 900, returnedValueAfter: after, alreadyRefunded: refunded });
    expect(refunded).toBe(900);
  });

  it('a full return of ten 1000 lines with a 5 discount refunds 9995, not 10000', () => {
    expect(cumulativeRefund({ subtotal: 10000, total: 9995, returnedValueAfter: 10000, alreadyRefunded: 0 })).toBe(9995);
  });

  it('a 333x3 line on 999 -> 899 refunds 899 over three single-unit returns', () => {
    let refunded = 0;
    for (const after of [333, 666, 999]) refunded += cumulativeRefund({ subtotal: 999, total: 899, returnedValueAfter: after, alreadyRefunded: refunded });
    expect(refunded).toBe(899);
  });
});

describe('discount schema', () => {
  it('accepts ordinary two-decimal percentages despite float arithmetic', () => {
    for (const value of [1.1, 2.2, 5.1, 0.07, 12.5, 10]) {
      const r = saleCreateBody.safeParse({ items: [{ variantId: '00000000-0000-4000-8000-000000000001', qty: 1 }], discount: { type: 'PCT', value }, paymentMethod: 'CASH' });
      expect(r.success, String(value)).toBe(true);
    }
    const bad = saleCreateBody.safeParse({ items: [{ variantId: '00000000-0000-4000-8000-000000000001', qty: 1 }], discount: { type: 'PCT', value: 1.234 }, paymentMethod: 'CASH' });
    expect(bad.success).toBe(false);
  });
});
