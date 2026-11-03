import { z } from 'zod';
import { paginationQuery, uuidSchema } from './common';
import { INT4_MAX } from './products';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

export const movementTypes = ['INITIAL', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT'] as const;

/** `from`/`to` are UTC calendar days: `from 00:00Z <= created_at < to + 1 day 00:00Z`. */
export const movementsQuery = paginationQuery
  .extend({
    variantId: uuidSchema.optional(),
    productId: uuidSchema.optional(),
    type: z.enum(movementTypes).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    userId: uuidSchema.optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();
export type MovementsQuery = z.infer<typeof movementsQuery>;

export const adjustmentReasons = ['DAMAGED', 'LOST', 'FOUND', 'CORRECTION', 'OTHER'] as const;

const adjustmentItem = z
  .object({
    variantId: uuidSchema,
    qtyDelta: z.number().int().min(-INT4_MAX).max(INT4_MAX).optional(),
    newQty: z.number().int().min(0).max(INT4_MAX).optional(),
    reason: z.enum(adjustmentReasons),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((i) => (i.qtyDelta !== undefined) !== (i.newQty !== undefined), {
    message: 'Provide exactly one of qtyDelta or newQty',
    path: ['qtyDelta'],
  })
  .refine((i) => i.qtyDelta !== 0, { message: 'Must be a non-zero integer', path: ['qtyDelta'] });

export const adjustmentsBody = z.object({ items: z.array(adjustmentItem).min(1).max(200) }).strict();
export type AdjustmentsInput = z.infer<typeof adjustmentsBody>;
