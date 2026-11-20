import { describe, expect, it } from 'vitest';
import { buildSku, defaultBaseSku, previewBaseSku, skuPart } from '@/lib/sku';
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

describe('base SKU generation, edge cases', () => {
  it('is deterministic and ignores case, spacing and punctuation', () => {
    expect(defaultBaseSku('northline', 'chino   slim!')).toBe('NO-CHI');
    expect(defaultBaseSku('Northline', 'Chino Slim')).toBe(defaultBaseSku('Northline', 'Chino Slim'));
  });

  it('pads short brands and names with X rather than producing an empty part', () => {
    expect(defaultBaseSku('', '')).toBe('XX-XXX');
    expect(defaultBaseSku('N', 'T')).toBe('NX-TXX');
  });

  it('gives every name with no A–Z or 0–9 the same stem (Arabic, emoji, symbols)', () => {
    // Known limitation: such names collide and rely on the -2, -3… suffixes.
    expect(defaultBaseSku('Northline', 'قميص')).toBe('NO-XXX');
    expect(defaultBaseSku('Northline', '👕👖')).toBe('NO-XXX');
  });

  it('keeps digits in the name part', () => {
    expect(defaultBaseSku('Northline', '501 Jeans')).toBe('NO-501');
  });

  it('only ever yields A–Z, 0–9 and one dash, so it always passes the PATCH regex', () => {
    const inputs = ['Chino Slim', '  ', 'Ünïcödé Tee', '50/50 — Shirt #2', 'x'.repeat(200), 'Brand-Name', '\u0000\t\n'];
    for (const brand of ['Northline', '', 'A', 'Brand & Co.', 'ÉLAN']) {
      for (const name of inputs) expect(defaultBaseSku(brand, name)).toMatch(/^[A-Z0-9]{2}-[A-Z0-9]{3}$/);
    }
  });
});

describe('previewBaseSku (form preview)', () => {
  it('matches the server rule once brand and name are known', () => {
    expect(previewBaseSku('Northline', 'Chino Slim')).toBe(defaultBaseSku('Northline', 'Chino Slim'));
  });

  it('is empty until both brand and a non-blank name are present', () => {
    expect(previewBaseSku(undefined, 'Chino Slim')).toBe('');
    expect(previewBaseSku('', 'Chino Slim')).toBe('');
    expect(previewBaseSku('Northline', '   ')).toBe('');
    expect(previewBaseSku('Northline', '')).toBe('');
  });
});
