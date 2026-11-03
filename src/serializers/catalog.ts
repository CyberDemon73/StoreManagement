import type { BrandRow, CategoryRow, ProductRow, SupplierRow, VariantRow } from '@/db/schema';
import type { Role } from '@/lib/permissions';
import { stripCostFields } from './seller';

// Output shapes mirror the frontend's src/types.ts (the backend never imports that file).

export interface ColorRef {
  name: string;
  hex: string;
}

export interface BrandOut {
  id: string;
  name: string;
  logoUrl?: string;
  isActive: boolean;
  productCount: number;
  variantCount: number;
}

export interface CategoryOut {
  id: string;
  name: string;
  parentId?: string;
  isActive: boolean;
  productCount: number;
}

export interface SupplierOut {
  id: string;
  name: string;
  phone?: string;
  notes?: string;
  isActive: boolean;
  purchaseCount: number;
  lastPurchaseAt: string | null;
}

export interface VariantOut {
  id: string;
  productId: string;
  size: string;
  color: ColorRef;
  sku: string;
  barcode?: string;
  /** Hidden for sellers. */
  costPrice?: number;
  sellPrice: number;
  quantity: number;
  lowStockThreshold: number;
  isActive: boolean;
}

export interface ProductOut {
  id: string;
  name: string;
  brandId: string;
  categoryId: string;
  description?: string;
  baseSku: string;
  images: string[];
  /** Hidden for sellers. */
  defaultCost?: number;
  defaultPrice: number;
  status: 'ACTIVE' | 'ARCHIVED';
  tags: string[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductAggregates {
  variantCount: number;
  totalQty: number;
  lowCount: number;
  outCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  tint: string | null;
}

export interface ProductListItemOut extends ProductOut {
  brand: { id: string; name: string };
  category: { id: string; name: string };
  variantCount: number;
  totalQty: number;
  lowCount: number;
  outCount: number;
  minPrice: number;
  maxPrice: number;
  lowStock: boolean;
  coverImage?: string;
  /** Hidden for sellers. */
  marginPct?: number;
  tint: string;
}

export interface ProductDetailOut extends ProductListItemOut {
  variants: VariantOut[];
  sizes: string[];
  colors: ColorRef[];
  soldLast30d: number;
}

export interface VariantWithProductOut extends VariantOut {
  product: { id: string; name: string; baseSku: string; images: string[]; brandName: string; tint: string };
}

export const DEFAULT_TINT = '#E6E3DC';

function omitNullish<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out as T;
}

/** Sellers never receive cost/margin fields; everyone else gets the full shape. */
export function forRole<T>(value: T, role: Role): T {
  return role === 'SELLER' ? stripCostFields(value) : value;
}

/** Gross margin as a percentage with one decimal; null when there is no cost or no price. */
export function marginPct(price: number, cost: number | null | undefined): number | null {
  if (cost == null || price <= 0) return null;
  return Math.round(((price - cost) / price) * 1000) / 10;
}

export function toBrand(row: BrandRow, counts: { productCount: number; variantCount: number }): BrandOut {
  return omitNullish({ id: row.id, name: row.name, logoUrl: row.logoUrl, isActive: row.isActive, ...counts }) as BrandOut;
}

export function toCategory(row: CategoryRow, counts: { productCount: number }): CategoryOut {
  return omitNullish({ id: row.id, name: row.name, parentId: row.parentId, isActive: row.isActive, ...counts }) as CategoryOut;
}

export function toSupplier(row: SupplierRow, counts: { purchaseCount: number; lastPurchaseAt: string | null }): SupplierOut {
  return {
    ...(omitNullish({ id: row.id, name: row.name, phone: row.phone, notes: row.notes, isActive: row.isActive }) as Omit<
      SupplierOut,
      'purchaseCount' | 'lastPurchaseAt'
    >),
    purchaseCount: counts.purchaseCount,
    lastPurchaseAt: counts.lastPurchaseAt,
  };
}

export function toVariant(row: VariantRow): VariantOut {
  return omitNullish({
    id: row.id,
    productId: row.productId,
    size: row.size,
    color: { name: row.colorName, hex: row.colorHex },
    sku: row.sku,
    barcode: row.barcode,
    costPrice: row.costPrice,
    sellPrice: row.sellPrice,
    quantity: row.quantity,
    lowStockThreshold: row.lowStockThreshold,
    isActive: row.isActive,
  }) as VariantOut;
}

export function toProduct(row: ProductRow): ProductOut {
  return omitNullish({
    id: row.id,
    name: row.name,
    brandId: row.brandId,
    categoryId: row.categoryId,
    description: row.description,
    baseSku: row.baseSku,
    images: row.images,
    defaultCost: row.defaultCost,
    defaultPrice: row.defaultPrice,
    status: row.status,
    tags: row.tags,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }) as ProductOut;
}

export function toProductListItem(
  row: ProductRow,
  refs: { brand: { id: string; name: string }; category: { id: string; name: string } },
  agg: ProductAggregates,
): ProductListItemOut {
  const base = toProduct(row);
  const margin = marginPct(row.defaultPrice, row.defaultCost);
  return omitNullish({
    ...base,
    brand: refs.brand,
    category: refs.category,
    variantCount: agg.variantCount,
    totalQty: agg.totalQty,
    lowCount: agg.lowCount,
    outCount: agg.outCount,
    minPrice: agg.minPrice ?? row.defaultPrice,
    maxPrice: agg.maxPrice ?? row.defaultPrice,
    lowStock: agg.lowCount > 0 || agg.outCount > 0,
    coverImage: row.images[0],
    marginPct: margin,
    tint: agg.tint ?? DEFAULT_TINT,
  }) as ProductListItemOut;
}

export function toProductDetail(
  row: ProductRow,
  refs: { brand: { id: string; name: string }; category: { id: string; name: string } },
  agg: ProductAggregates,
  variantRows: VariantRow[],
): ProductDetailOut {
  const sizes: string[] = [];
  const colors: ColorRef[] = [];
  for (const v of variantRows) {
    if (!sizes.includes(v.size)) sizes.push(v.size);
    if (!colors.some((c) => c.name === v.colorName)) colors.push({ name: v.colorName, hex: v.colorHex });
  }
  return {
    ...toProductListItem(row, refs, agg),
    variants: variantRows.map(toVariant),
    sizes,
    colors,
    soldLast30d: 0,
  };
}

export function toVariantWithProduct(
  row: VariantRow,
  product: { id: string; name: string; baseSku: string; images: string[]; brandName: string; tint: string | null },
): VariantWithProductOut {
  return { ...toVariant(row), product: { ...product, tint: product.tint ?? DEFAULT_TINT } };
}
