import { describe, expect, it } from 'vitest';
import { isFootwearCategory, sizeGroups } from '@/lib/sizes';

describe('sizeGroups', () => {
  it('lists store presets first, then letters, waist, shoes and One Size', () => {
    const groups = sizeGroups([{ name: 'Kids', sizes: ['4Y', '6Y'] }], []);
    expect(groups.map((g) => g.name)).toEqual(['Kids', 'Letters', 'Waist', 'Shoes (EU)', 'Other']);
    expect(groups[1]!.sizes).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
  });

  it('shows each size once, in its first group', () => {
    const all = sizeGroups([], []).flatMap((g) => g.sizes);
    expect(all.filter((s) => s === '38')).toHaveLength(1);
    expect(all).toContain('50');
  });

  it('puts the full shoe run 30–50 first for footwear and drops waist sizes', () => {
    const groups = sizeGroups([], [], { footwear: true });
    expect(groups[0]!.name).toBe('Shoes (EU)');
    expect(groups[0]!.sizes).toEqual(Array.from({ length: 21 }, (_, i) => String(30 + i)));
    expect(groups.map((g) => g.name)).not.toContain('Waist');
  });

  it('keeps custom sizes already on the product in a Custom group', () => {
    expect(sizeGroups([], ['M', '5XL']).at(-1)).toEqual({ name: 'Custom', sizes: ['5XL'] });
  });
});

describe('isFootwearCategory', () => {
  it('recognises footwear category names', () => {
    for (const n of ['Shoes', 'Footwear', 'Sneakers', 'Boots', 'Sandals', 'أحذية']) expect(isFootwearCategory(n)).toBe(true);
    for (const n of ['Tops', 'Bottoms', undefined]) expect(isFootwearCategory(n)).toBe(false);
  });
});
