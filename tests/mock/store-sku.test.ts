import { describe, expect, it } from 'vitest';
import * as store from '@/mock/store';
import * as D from '@/mock/data';
import { defaultBaseSku } from '@/lib/sku';

const input = (name: string, brandId: string) => ({ name, brandId, categoryId: D.categories[0]!.id, defaultPrice: 1000 });

describe('offline mock backend: generated base SKU', () => {
  it('generates the same stem as the server and numbers clashes -2, -3…', () => {
    const brand = D.brands[0]!;
    const a = store.createProduct(input('Mock Chino Slim', brand.id), 'u1');
    const b = store.createProduct(input('Mock Chino Slim', brand.id), 'u1');
    const c = store.createProduct(input('Mock Chino Slim', brand.id), 'u1');
    const stem = defaultBaseSku(brand.name, 'Mock Chino Slim');
    expect([a.baseSku, b.baseSku, c.baseSku]).toEqual([stem, `${stem}2`, `${stem}3`]);
  });

  it('ignores a baseSku passed in by a caller (the field no longer exists on the input)', () => {
    const brand = D.brands[0]!;
    const p = store.createProduct({ ...input('Mock Tee', brand.id), baseSku: 'HACK-ME' } as never, 'u1');
    expect(p.baseSku).not.toBe('HACK-ME');
  });
});
