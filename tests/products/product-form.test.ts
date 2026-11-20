import { describe, expect, it } from 'vitest';
import { derive, formFromProduct, planEditSave, type ProductFormState } from '@/screens/products/product-form';
import type { ProductDetail, Variant } from '@/types';

const BLACK = { name: 'Black', hex: '#000000' };
const WHITE = { name: 'White', hex: '#FFFFFF' };

function variant(size: string, color: typeof BLACK, over: Partial<Variant> = {}): Variant {
  return { id: `${size}-${color.name}`, productId: 'p1', size, color, sku: `SKU-${size}-${color.name}`, sellPrice: 1000, costPrice: 400, quantity: 0, lowStockThreshold: 0, isActive: true, ...over };
}

function product(variants: Variant[]): ProductDetail {
  return {
    id: 'p1', name: 'Tee', brandId: 'b1', categoryId: 'c1', baseSku: 'TEE', tags: [], images: [], sizes: [...new Set(variants.map((v) => v.size))], colors: [BLACK, WHITE],
    defaultCost: 400, defaultPrice: 1000, status: 'ACTIVE', tint: '#000000', variantCount: variants.length, totalQty: 0, lowCount: 0, outCount: 0, minPrice: 1000, maxPrice: 1000,
    brand: { id: 'b1', name: 'Brand' }, category: { id: 'c1', name: 'Tops' }, variants,
  } as unknown as ProductDetail;
}

function form(over: Partial<ProductFormState>): ProductFormState {
  return { name: 'Tee', brandId: 'b1', categoryId: 'c1', baseSku: 'TEE', description: '', tags: [], images: [], sizes: [], colors: [], setInitialQty: true, initialQty: {}, overrides: {}, defaultCost: 400, defaultPrice: 1000, ...over };
}

describe('formFromProduct on edit', () => {
  it('prefills every cell quantity and barcode from the existing variants', () => {
    const p = product([variant('M', BLACK, { quantity: 2, barcode: '1234567' }), variant('M', WHITE, { quantity: 5 })]);
    const f = formFromProduct(p);
    expect(f.initialQty).toEqual({ 'M|Black': 2, 'M|White': 5 });
    expect(f.barcodes).toEqual({ 'M|Black': '1234567' });
    expect(f.setInitialQty).toBe(true);
  });
});

describe('derive on edit', () => {
  it('drops a removed size from units, stock value and override counts', () => {
    const p = product([variant('M', BLACK, { quantity: 2 }), variant('S', BLACK, { quantity: 3 })]);
    const f = { ...formFromProduct(p), sizes: ['S'], colors: [BLACK] };
    f.overrides = { 'M|Black': { price: 900 }, 'S|Black': { cost: 350 } };
    const d = derive(f);
    expect(d.variantCount).toBe(1);
    expect(d.units).toBe(3);
    expect(d.overrideCount).toBe(1);
  });
});

describe('planEditSave', () => {
  it('blocks the save when a removed cell still holds stock', () => {
    const p = product([variant('M', BLACK, { quantity: 2 }), variant('S', BLACK, { quantity: 0 })]);
    const plan = planEditSave(form({ sizes: ['S'], colors: [BLACK], initialQty: { 'S|Black': 0 } }), p.variants);
    expect(plan.blocked).toEqual([{ size: 'M', color: 'Black', quantity: 2 }]);
    expect(plan.remove).toEqual([]);
  });

  it('schedules zero-stock removed cells for deletion when nothing is blocked', () => {
    const p = product([variant('M', BLACK, { quantity: 0 }), variant('S', BLACK, { quantity: 1 })]);
    const plan = planEditSave(form({ sizes: ['S'], colors: [BLACK], initialQty: { 'S|Black': 1 } }), p.variants);
    expect(plan.blocked).toEqual([]);
    expect(plan.remove.map((v) => v.id)).toEqual(['M-Black']);
  });

  it('leaves already-deactivated removed cells alone', () => {
    const p = product([variant('M', BLACK, { quantity: 0, isActive: false }), variant('S', BLACK, { quantity: 1 })]);
    const plan = planEditSave(form({ sizes: ['S'], colors: [BLACK], initialQty: { 'S|Black': 1 } }), p.variants);
    expect(plan).toEqual({ blocked: [], remove: [], reactivate: [] });
  });

  it('reactivates an inactive cell when its size or colour is added back', () => {
    const p = product([variant('M', BLACK, { quantity: 0, isActive: false }), variant('S', BLACK, { quantity: 1 })]);
    const plan = planEditSave(form({ sizes: ['S', 'M'], colors: [BLACK], initialQty: { 'S|Black': 1, 'M|Black': 0 } }), p.variants);
    expect(plan.reactivate.map((v) => v.id)).toEqual(['M-Black']);
    expect(plan.remove).toEqual([]);
  });

  it('keeps cells that are still in the matrix out of both lists', () => {
    const p = product([variant('M', BLACK, { quantity: 2 })]);
    const plan = planEditSave(form({ sizes: ['M'], colors: [BLACK], initialQty: { 'M|Black': 4 } }), p.variants);
    expect(plan).toEqual({ blocked: [], remove: [], reactivate: [] });
  });
});
