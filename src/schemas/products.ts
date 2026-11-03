import { z } from 'zod';
import { paginationQuery, uuidSchema } from './common';

export const money = z.number().int().nonnegative();

const upper = (s: string) => s.toUpperCase();

export const colorRef = z
  .object({
    name: z.string().trim().min(1).max(30),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a #rrggbb colour'),
  })
  .strict();
export type ColorRefInput = z.infer<typeof colorRef>;

export const variantMatrixBody = z
  .object({
    sizes: z.array(z.string().trim().min(1).max(20)).min(1).max(30),
    colors: z.array(colorRef).min(1).max(30),
    /** A single quantity for every cell, or a map keyed "<size>|<colorName>". */
    initialQty: z.union([z.number().int().nonnegative(), z.record(z.string(), z.number().int().nonnegative())]).optional(),
    costPrice: money.optional(),
    sellPrice: money.optional(),
  })
  .strict();
export type VariantMatrixInput = z.infer<typeof variantMatrixBody>;

export const productCreateBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    brandId: uuidSchema,
    categoryId: uuidSchema,
    description: z.string().trim().max(2000).optional(),
    baseSku: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{2,40}$/, 'Letters, digits and dashes only (2–40)')
      .transform(upper)
      .optional(),
    images: z.array(z.string().url().startsWith('https://').max(500)).max(10).optional(),
    defaultCost: money.optional(),
    defaultPrice: money,
    tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
    variants: variantMatrixBody.optional(),
  })
  .strict();
export type ProductCreateInput = z.infer<typeof productCreateBody>;

export const productPatchBody = productCreateBody.omit({ variants: true }).partial().strict();
export type ProductPatchInput = z.infer<typeof productPatchBody>;

export const PRODUCT_SORTS = ['name', '-name', 'updated', '-updated', 'price', '-price', 'qty', '-qty'] as const;

export const productListQuery = paginationQuery
  .extend({
    q: z.string().trim().max(100).optional(),
    brandId: uuidSchema.optional(),
    categoryId: uuidSchema.optional(),
    size: z.string().trim().max(20).optional(),
    color: z.string().trim().max(30).optional(),
    stock: z.enum(['in', 'low', 'out']).optional(),
    minPrice: z.coerce.number().int().nonnegative().optional(),
    maxPrice: z.coerce.number().int().nonnegative().optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
    sort: z.enum(PRODUCT_SORTS).default('-updated'),
  })
  .strict();
export type ProductListQuery = z.infer<typeof productListQuery>;

/** PATCH /variants/:id — quantity is deliberately absent (ledger only). */
export const variantPatchBody = z
  .object({
    sellPrice: money.optional(),
    costPrice: money.optional(),
    lowStockThreshold: z.number().int().nonnegative().optional(),
    barcode: z.string().trim().min(4).max(32).nullable().optional(),
    isActive: z.boolean().optional(),
    sku: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{2,60}$/, 'Letters, digits and dashes only (2–60)')
      .transform(upper)
      .optional(),
  })
  .strict();
export type VariantPatchInput = z.infer<typeof variantPatchBody>;

export const variantLookupQuery = z
  .object({
    barcode: z.string().trim().min(1).max(64).optional(),
    sku: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine((q) => !!q.barcode || !!q.sku, { message: 'Provide barcode or sku', path: ['barcode'] });
export type VariantLookupQuery = z.infer<typeof variantLookupQuery>;

export const variantSearchQuery = z
  .object({
    q: z.string().trim().min(1).max(100),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type VariantSearchQuery = z.infer<typeof variantSearchQuery>;
