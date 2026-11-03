import { z } from 'zod';
import { uuidSchema } from './common';
import { INT4_MAX } from './products';

export const countStartBody = z
  .object({
    scope: z.string().trim().max(60).default('all'),
    productIds: z.array(uuidSchema).max(200).optional(),
  })
  .strict();

export const countItemsBody = z
  .object({
    items: z
      .array(z.object({ variantId: uuidSchema, countedQty: z.number().int().min(0).max(INT4_MAX) }).strict())
      .min(1)
      .max(500),
  })
  .strict();

export const countApplyBody = z.object({ uncountedAsZero: z.boolean().optional() }).strict();

export type CountStartInput = z.infer<typeof countStartBody>;
export type CountItemsInput = z.infer<typeof countItemsBody>;
export type CountApplyInput = z.infer<typeof countApplyBody>;
