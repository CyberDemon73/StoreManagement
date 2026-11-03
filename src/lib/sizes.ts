const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

const LETTERS = { name: 'Letters', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'] };
const WAIST = { name: 'Waist', sizes: ['28', '30', '32', '34', '36', '38', '40', '42'] };
const SHOES = { name: 'Shoes (EU)', sizes: range(30, 50) };
const OTHER = { name: 'Other', sizes: ['One Size'] };

/** Everyday size runs offered in the size dropdown, after the store's own presets. */
export const COMMON_SIZE_GROUPS: { name: string; sizes: string[] }[] = [LETTERS, WAIST, SHOES, OTHER];

/** A category that sells footwear (English or Arabic names). */
export function isFootwearCategory(name: string | undefined): boolean {
  return !!name && /shoe|foot\s*wear|sneaker|boot|sandal|slipper|loafer|heel|trainer|أحذية|حذاء|جزم|شوز/i.test(name);
}

/**
 * Size groups for the dropdown: store presets first, then the common runs, then any custom size
 * already on the product. For footwear the shoe run (30–50) comes first and waist sizes are left
 * out. A size appears once (in its first group), compared case-insensitively.
 */
export function sizeGroups(
  presets: { name: string; sizes: string[] }[],
  selected: string[],
  opts: { footwear?: boolean } = {},
): { name: string; sizes: string[] }[] {
  const seen = new Set<string>();
  const take = (sizes: string[]) =>
    sizes.filter((s) => {
      const k = s.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const common = opts.footwear ? [SHOES, LETTERS, OTHER] : COMMON_SIZE_GROUPS;
  const groups = [...presets, ...common].map((g) => ({ name: g.name, sizes: take(g.sizes) }));
  const custom = take(selected);
  if (custom.length) groups.push({ name: 'Custom', sizes: custom });
  return groups.filter((g) => g.sizes.length > 0);
}
