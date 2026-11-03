import { describe, expect, it } from 'vitest';
import type { VariantRow } from '@/db/schema';
import { forRole, marginPct, toVariant, type ProductDetailOut } from '@/serializers/catalog';
import { expectNoSellerKeys } from '../helpers/catalog';

const now = new Date('2026-01-01T00:00:00Z');

const variantRow: VariantRow = {
  id: 'v1',
  productId: 'p1',
  size: 'S',
  colorName: 'Black',
  colorHex: '#000000',
  sku: 'NO-CHI-S-BLACK',
  barcode: null,
  costPrice: 600,
  sellPrice: 1000,
  quantity: 4,
  lowStockThreshold: 3,
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

describe('catalog serializers', () => {
  it('toVariant exposes color as an object and omits null barcode', () => {
    const v = toVariant(variantRow);
    expect(v).toEqual({
      id: 'v1',
      productId: 'p1',
      size: 'S',
      color: { name: 'Black', hex: '#000000' },
      sku: 'NO-CHI-S-BLACK',
      costPrice: 600,
      sellPrice: 1000,
      quantity: 4,
      lowStockThreshold: 3,
      isActive: true,
    });
    expect('colorName' in v).toBe(false);
    expect('barcode' in v).toBe(false);
  });

  it('marginPct rounds to one decimal and is null for a zero price', () => {
    expect(marginPct(1000, 600)).toBe(40);
    expect(marginPct(1000, 333)).toBe(66.7);
    expect(marginPct(0, 5)).toBeNull();
    expect(marginPct(1000, null)).toBeNull();
  });

  it('forRole strips cost fields for sellers at any depth and leaves managers untouched', () => {
    const detail = {
      id: 'p1',
      defaultCost: 600,
      marginPct: 40,
      variants: [toVariant(variantRow)],
    } as unknown as ProductDetailOut;
    const seller = forRole(detail, 'SELLER');
    expectNoSellerKeys(seller);
    expect(seller.variants[0]?.sku).toBe('NO-CHI-S-BLACK');
    expect(forRole(detail, 'MANAGER')).toBe(detail);
  });
});
