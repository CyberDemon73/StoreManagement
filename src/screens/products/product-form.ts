/**
 * Form model for /products/new and /products/[id]/edit: state shape, validation, derived
 * numbers (variant count, units, stock value, margins) and the review checklist. Pure functions,
 * no React.
 */
import { matrixKey } from '@/components/app/VariantMatrix';
import { marginPct } from '@/lib/format';
import type { ColorRef, ProductDetail } from '@/types';

export interface VariantOverride { cost?: number; price?: number }

export interface ProductFormState {
  name: string;
  brandId: string;
  categoryId: string;
  baseSku: string;
  description: string;
  tags: string[];
  /** Existing image URLs plus local object URLs for newly dropped files (never uploaded here). */
  images: string[];
  sizes: string[];
  colors: ColorRef[];
  setInitialQty: boolean;
  /** Keyed `size|color` (matrixKey). */
  initialQty: Record<string, number>;
  /** Optional scanned/typed barcodes keyed `size|color` (new products only). */
  barcodes?: Record<string, string>;
  defaultCost?: number;
  defaultPrice?: number;
  /** Per-variant cost/price overrides keyed `size|color`. */
  overrides: Record<string, VariantOverride>;
}

export const EMPTY_FORM: ProductFormState = { name: '', brandId: '', categoryId: '', baseSku: '', description: '', tags: [], images: [], sizes: [], colors: [], setInitialQty: false, initialQty: {}, overrides: {} };

export const STEPS = ['Basics', 'Images', 'Variants', 'Pricing', 'Review'] as const;

export function formFromProduct(p: ProductDetail): ProductFormState {
  const overrides: Record<string, VariantOverride> = {};
  for (const v of p.variants) {
    const o: VariantOverride = {};
    if (v.costPrice !== undefined && v.costPrice !== p.defaultCost) o.cost = v.costPrice;
    if (v.sellPrice !== p.defaultPrice) o.price = v.sellPrice;
    if (o.cost !== undefined || o.price !== undefined) overrides[matrixKey(v.size, v.color.name)] = o;
  }
  return { name: p.name, brandId: p.brandId, categoryId: p.categoryId, baseSku: p.baseSku, description: p.description ?? '', tags: [...p.tags], images: [...p.images], sizes: [...p.sizes], colors: p.colors.map((c) => ({ ...c })), setInitialQty: false, initialQty: {}, defaultCost: p.defaultCost, defaultPrice: p.defaultPrice, overrides };
}

export interface FormErrors { name?: string; brandId?: string; categoryId?: string; baseSku?: string; defaultPrice?: string; defaultCost?: string; variants?: string }

export function validate(f: ProductFormState): FormErrors {
  const e: FormErrors = {};
  if (!f.name.trim()) e.name = 'Product name is required';
  if (!f.brandId) e.brandId = 'Choose or create a brand';
  if (!f.categoryId) e.categoryId = 'Choose a category';
  if (f.defaultPrice === undefined || f.defaultPrice <= 0) e.defaultPrice = 'Price must be more than 0';
  if (f.defaultCost !== undefined && f.defaultCost < 0) e.defaultCost = 'Cost cannot be negative';
  if (f.baseSku && !/^[A-Za-z0-9-]{2,24}$/.test(f.baseSku.trim())) e.baseSku = 'Letters, numbers and dashes only (2–24)';
  return e;
}

/** Suggested base SKU: two letters of the brand + three consonant-ish letters of the name. */
export function suggestBaseSku(brandName: string | undefined, productName: string): string {
  const b = (brandName ?? 'XX').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase().padEnd(2, 'X');
  const n = productName.split(/\s+/).filter(Boolean).map((w) => w[0] ?? '').join('').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  return n ? `${b}-${n}` : '';
}

export const variantSku = (baseSku: string, size: string, color: string) => `${baseSku || 'SKU'}-${size.replace(/\s+/g, '')}-${color.slice(0, 3).toUpperCase()}`;

export interface Cell { key: string; size: string; color: ColorRef }

export interface Derived {
  cells: Cell[];
  variantCount: number;
  units: number;
  stockCost: number;
  stockRetail: number;
  belowCost: number;
  overrideCount: number;
  margin?: number;
  perUnit?: number;
}

export function derive(f: ProductFormState): Derived {
  const cells: Cell[] = f.sizes.flatMap((s) => f.colors.map((c) => ({ key: matrixKey(s, c.name), size: s, color: c })));
  let units = 0, stockCost = 0, stockRetail = 0, belowCost = 0;
  for (const cell of cells) {
    const q = f.setInitialQty ? f.initialQty[cell.key] ?? 0 : 0;
    const o = f.overrides[cell.key];
    const cost = o?.cost ?? f.defaultCost ?? 0;
    const price = o?.price ?? f.defaultPrice ?? 0;
    units += q;
    stockCost += q * cost;
    stockRetail += q * price;
    if (o && (o.cost !== undefined || o.price !== undefined) && price < cost) belowCost++;
  }
  const overrideCount = Object.values(f.overrides).filter((o) => o.cost !== undefined || o.price !== undefined).length;
  const margin = f.defaultPrice ? marginPct(f.defaultPrice, f.defaultCost) : undefined;
  const perUnit = f.defaultPrice !== undefined && f.defaultCost !== undefined ? f.defaultPrice - f.defaultCost : undefined;
  return { cells, variantCount: cells.length, units, stockCost, stockRetail, belowCost, overrideCount, margin, perUnit };
}

export interface SectionCheck { key: (typeof STEPS)[number]; label: string; ok: boolean; detail?: string }

export function checklist(f: ProductFormState, errors: FormErrors, d: Derived): SectionCheck[] {
  const basicsErr = errors.name ?? errors.brandId ?? errors.categoryId ?? errors.baseSku;
  const pricingErr = errors.defaultPrice ?? errors.defaultCost ?? (d.belowCost > 0 ? `${d.belowCost} variant${d.belowCost === 1 ? '' : 's'} below cost` : undefined);
  return [
    { key: 'Basics', label: 'Basics', ok: !basicsErr, detail: basicsErr },
    { key: 'Images', label: `Images · ${f.images.length}`, ok: true },
    { key: 'Variants', label: `Variants · ${d.variantCount}${f.setInitialQty ? ` · ${d.units} units` : ''}`, ok: d.variantCount > 0, detail: d.variantCount === 0 ? 'Pick at least one size and one color' : undefined },
    { key: 'Pricing', label: 'Pricing', ok: !pricingErr, detail: pricingErr },
  ];
}

export interface DraftRecord { form: ProductFormState; savedAt: string }
export const DRAFT_KEY = 'avenue.productDraft';
