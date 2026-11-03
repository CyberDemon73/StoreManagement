import { describe, expect, it } from 'vitest';
import { buildSku, defaultBaseSku, skuPart } from '@/lib/sku';
import { productCreateBody, productListQuery, variantMatrixBody, variantPatchBody } from '@/schemas/products';

describe('sku helpers', () => {
  it('normalises parts to A-Z0-9', () => {
    expect(skuPart('32 W')).toBe('32W');
    expect(skuPart('Navy Blue')).toBe('NAVYBLUE');
    expect(skuPart('x-l')).toBe('XL');
  });

  it('builds BASE-SIZE-COLOR', () => {
    expect(buildSku('NL-CHI', '32 W', 'Navy Blue')).toBe('NL-CHI-32W-NAVYBLUE');
  });

  it('derives a default base SKU from brand and name, padded', () => {
    expect(defaultBaseSku('Northline', 'Chino Slim')).toBe('NO-CHI');
    expect(defaultBaseSku('A', 'B')).toBe('AX-BXX');
  });
});

describe('product schemas', () => {
  it('list query applies defaults and whitelists sort', () => {
    expect(productListQuery.parse({})).toEqual({ page: 1, pageSize: 25, status: 'ACTIVE', sort: '-updated' });
    expect(productListQuery.safeParse({ sort: 'price-asc' }).success).toBe(false);
    expect(productListQuery.parse({ sort: '-qty', minPrice: '100' })).toMatchObject({ sort: '-qty', minPrice: 100 });
  });

  it('variant patch never accepts quantity', () => {
    expect(variantPatchBody.safeParse({ quantity: 5 }).success).toBe(false);
    expect(variantPatchBody.parse({ sku: 'nl-chi-s-black' })).toEqual({ sku: 'NL-CHI-S-BLACK' });
    expect(variantPatchBody.parse({ barcode: null })).toEqual({ barcode: null });
  });

  it('rejects values beyond int4 bounds', () => {
    const base = { name: 'X', brandId: '00000000-0000-4000-8000-000000000000', categoryId: '00000000-0000-4000-8000-000000000000' };
    expect(productCreateBody.safeParse({ ...base, defaultPrice: 10_000_000_000 }).success).toBe(false);
    expect(productCreateBody.safeParse({ ...base, defaultPrice: 100 }).success).toBe(true);
    const m = { sizes: ['S'], colors: [{ name: 'Black', hex: '#000000' }] };
    expect(variantMatrixBody.safeParse({ ...m, initialQty: 3_000_000_000 }).success).toBe(false);
    expect(variantMatrixBody.safeParse({ ...m, initialQty: { 'S|Black': 3_000_000_000 } }).success).toBe(false);
    expect(variantPatchBody.safeParse({ lowStockThreshold: 3_000_000_000 }).success).toBe(false);
    expect(productListQuery.safeParse({ page: 1_000_000 }).success).toBe(false);
    expect(productListQuery.safeParse({ minPrice: '3000000000' }).success).toBe(false);
    expect(productListQuery.safeParse({ maxPrice: '3000000000' }).success).toBe(false);
  });
});
