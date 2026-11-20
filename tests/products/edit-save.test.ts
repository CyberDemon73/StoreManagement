import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { formFromProduct, planEditSave, type ProductFormState } from '@/screens/products/product-form';
import { saveProductEdits, type EditClient } from '@/screens/products/edit-save';
import type { ProductDetail, Variant } from '@/types';

const BLACK = { name: 'Black', hex: '#000000' };
const WHITE = { name: 'White', hex: '#FFFFFF' };
const BASE = { name: 'Tee', brandId: 'b1', categoryId: 'c1', defaultCost: 400, defaultPrice: 1000, tags: [] };

function variant(size: string, color: typeof BLACK, over: Partial<Variant> = {}): Variant {
  return { id: `${size}-${color.name}`, productId: 'p1', size, color, sku: `TEE-${size}-${color.name}`, sellPrice: 1000, costPrice: 400, quantity: 0, lowStockThreshold: 0, isActive: true, ...over };
}

function product(variants: Variant[]): ProductDetail {
  return {
    id: 'p1', name: 'Tee', brandId: 'b1', categoryId: 'c1', baseSku: 'TEE', tags: [], images: [], description: undefined,
    sizes: [...new Set(variants.filter((v) => v.isActive).map((v) => v.size))], colors: [BLACK, WHITE],
    defaultCost: 400, defaultPrice: 1000, status: 'ACTIVE', tint: '#000000', variantCount: variants.length,
    totalQty: 0, lowCount: 0, outCount: 0, minPrice: 1000, maxPrice: 1000, brand: { id: 'b1', name: 'Brand' }, category: { id: 'c1', name: 'Tops' }, variants,
  } as unknown as ProductDetail;
}

/** Fake of the API surface the save uses; every call is recorded in order. */
function fakeClient(opts: { created?: Variant[]; removeError?: unknown } = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const rec = (name: string, ret?: unknown) => vi.fn(async (...args: unknown[]) => { calls.push({ name, args }); return ret; });
  const client = {
    products: { update: rec('products.update'), addVariants: rec('products.addVariants', opts.created ?? []) },
    variants: {
      update: rec('variants.update'),
      remove: vi.fn(async (id: string) => { calls.push({ name: 'variants.remove', args: [id] }); if (opts.removeError) throw opts.removeError; }),
    },
    stock: { adjust: rec('stock.adjust') },
  } as unknown as EditClient;
  return { client, calls, names: () => calls.map((c) => c.name) };
}

function run(current: ProductDetail, form: ProductFormState, client: EditClient) {
  return saveProductEdits(client, { productId: 'p1', current, form, base: BASE, images: [], plan: planEditSave(form, current.variants) });
}

describe('saveProductEdits', () => {
  it('books a changed quantity as one adjustment and leaves unchanged cells out', async () => {
    const current = product([variant('M', BLACK, { quantity: 2 }), variant('M', WHITE, { quantity: 5 })]);
    const form = { ...formFromProduct(current), initialQty: { 'M|Black': 1, 'M|White': 5 } };
    const { client, calls } = fakeClient();
    await run(current, form, client);
    const adj = calls.filter((c) => c.name === 'stock.adjust');
    expect(adj).toHaveLength(1);
    expect(adj[0]?.args[0]).toEqual([{ variantId: 'M-Black', newQty: 1, reason: 'CORRECTION', note: 'Set on product edit' }]);
    expect(calls.some((c) => c.name === 'products.addVariants')).toBe(false);
  });

  it('does not call the ledger when no quantity changed', async () => {
    const current = product([variant('M', BLACK, { quantity: 2 })]);
    const { client, names } = fakeClient();
    await run(current, formFromProduct(current), client);
    expect(names()).not.toContain('stock.adjust');
  });

  it('adds new cells with only their own barcodes, then books their starting quantity as an adjustment', async () => {
    const current = product([variant('M', BLACK, { quantity: 2 })]);
    const form: ProductFormState = { ...formFromProduct(current), sizes: ['M', 'S'], colors: [BLACK], initialQty: { 'M|Black': 2, 'S|Black': 1 }, barcodes: { 'M|Black': '1111111', 'S|Black': '2222222' } };
    const created = [variant('S', BLACK, { id: 'S-new', quantity: 0 })];
    const { client, calls } = fakeClient({ created });
    await run(current, form, client);
    const add = calls.find((c) => c.name === 'products.addVariants')!;
    expect(add.args[1]).toMatchObject({ sizes: ['M', 'S'], barcodes: { 'S|Black': '2222222' } });
    expect((add.args[1] as { barcodes: object }).barcodes).not.toHaveProperty('M|Black');
    expect(calls.find((c) => c.name === 'stock.adjust')!.args[0]).toEqual([{ variantId: 'S-new', newQty: 1, reason: 'CORRECTION', note: 'Set on product edit' }]);
  });

  it('sends a barcode only when it changed, and null when it is cleared', async () => {
    const current = product([variant('M', BLACK, { barcode: '1234567' }), variant('M', WHITE, { barcode: '7654321' })]);
    const form: ProductFormState = { ...formFromProduct(current), barcodes: { 'M|Black': '1234567', 'M|White': '' } };
    const { client, calls } = fakeClient();
    await run(current, form, client);
    const updates = calls.filter((c) => c.name === 'variants.update');
    expect(updates).toEqual([{ name: 'variants.update', args: ['M-White', { barcode: null }] }]);
  });

  it('reactivates a hidden cell that is back in the lists, before any quantity is booked', async () => {
    const current = product([variant('M', BLACK, { quantity: 0, isActive: false }), variant('S', BLACK, { quantity: 1 })]);
    const form: ProductFormState = { ...formFromProduct(current), sizes: ['S', 'M'], colors: [BLACK], initialQty: { 'S|Black': 1, 'M|Black': 3 } };
    const { client, calls } = fakeClient();
    await run(current, form, client);
    const names = calls.map((c) => c.name);
    expect(calls.find((c) => c.name === 'variants.update')!.args).toEqual(['M-Black', { isActive: true }]);
    expect(names.indexOf('variants.update')).toBeLessThan(names.indexOf('stock.adjust'));
    expect(calls.find((c) => c.name === 'stock.adjust')!.args[0]).toEqual([{ variantId: 'M-Black', newQty: 3, reason: 'CORRECTION', note: 'Set on product edit' }]);
  });

  it('deletes a removed zero-stock cell', async () => {
    const current = product([variant('M', BLACK, { quantity: 0 }), variant('S', BLACK, { quantity: 1 })]);
    const form = { ...formFromProduct(current), sizes: ['S'], colors: [BLACK], initialQty: { 'S|Black': 1 } };
    const { client, calls } = fakeClient();
    await run(current, form, client);
    expect(calls.filter((c) => c.name === 'variants.remove').map((c) => c.args)).toEqual([['M-Black']]);
    expect(calls.some((c) => c.name === 'variants.update')).toBe(false);
  });

  it('deactivates a removed cell whose delete is refused for ledger history', async () => {
    const current = product([variant('M', BLACK, { quantity: 0 }), variant('S', BLACK, { quantity: 1 })]);
    const form = { ...formFromProduct(current), sizes: ['S'], colors: [BLACK], initialQty: { 'S|Black': 1 } };
    const { client, calls } = fakeClient({ removeError: new ApiError('CONFLICT', 'Variant has stock or movements', 409) });
    await run(current, form, client);
    expect(calls.find((c) => c.name === 'variants.update')!.args).toEqual(['M-Black', { isActive: false }]);
  });

  it('rethrows any delete failure other than a ledger-history conflict', async () => {
    const current = product([variant('M', BLACK, { quantity: 0 }), variant('S', BLACK, { quantity: 1 })]);
    const form = { ...formFromProduct(current), sizes: ['S'], colors: [BLACK], initialQty: { 'S|Black': 1 } };
    const { client } = fakeClient({ removeError: new ApiError('INTERNAL', 'boom', 500) });
    await expect(run(current, form, client)).rejects.toThrow('boom');
  });

  it('saves the product fields first and deletes last', async () => {
    const current = product([variant('M', BLACK, { quantity: 0 }), variant('S', BLACK, { quantity: 1 })]);
    const form = { ...formFromProduct(current), sizes: ['S'], colors: [BLACK], initialQty: { 'S|Black': 4 }, name: 'Tee v2' };
    const { client, names } = fakeClient();
    await run(current, form, client);
    expect(names()[0]).toBe('products.update');
    expect(names().at(-1)).toBe('variants.remove');
  });
});
