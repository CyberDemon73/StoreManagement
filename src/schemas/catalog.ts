import { z } from 'zod';
import { uuidSchema } from './common';

export const brandBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    logoUrl: z.string().url().max(500).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export const brandPatch = brandBody.partial().strict();
export type BrandInput = z.infer<typeof brandBody>;
export type BrandPatch = z.infer<typeof brandPatch>;

export const categoryBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    parentId: uuidSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export const categoryPatch = categoryBody
  .extend({ parentId: uuidSchema.nullable().optional() })
  .partial()
  .strict();
export type CategoryInput = z.infer<typeof categoryBody>;
export type CategoryPatch = z.infer<typeof categoryPatch>;

export const supplierBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().max(30).optional(),
    notes: z.string().trim().max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export const supplierPatch = supplierBody.partial().strict();
export type SupplierInput = z.infer<typeof supplierBody>;
export type SupplierPatch = z.infer<typeof supplierPatch>;

export const idParams = z.object({ id: uuidSchema }).strict();
