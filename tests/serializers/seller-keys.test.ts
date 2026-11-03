import { describe, expect, it } from 'vitest';
import { stripCostFields } from '@/serializers/seller';

// Deliberately NOT built from FORBIDDEN_SELLER_KEYS: a hard-coded list so the helper and the
// stripping list cannot drift together again (the Sprint 3 `cost` leak).
describe('seller stripping covers every cost/profit key the API emits', () => {
  it('removes cost, profit and margin fields at any depth', () => {
    const out = stripCostFields({
      cost: 1500,
      profit: 500,
      grossProfit: 1,
      valueAtCost: 2,
      stockValueCost: 3,
      cogs: 4,
      marginPct: 5,
      items: [{ unitCost: 500, costPrice: 500, defaultCost: 1, sku: 'X' }],
    });
    expect(out).toEqual({ items: [{ sku: 'X' }] });
  });
});
