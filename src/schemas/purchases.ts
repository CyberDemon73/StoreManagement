import { z } from 'zod';
import { paginationQuery, uuidSchema } from './common';
import { INT4_MAX, money } from './products';

export const purchaseItemBody = z
  .object({
    variantId: uuidSchema,
    qty: z.number().int().min(1).max(INT4_MAX),
    unitCost: money,
  })
  .strict();

export const purchaseBody = z
  .object({
    supplierId: uuidSchema.optional(),
    invoiceRef: z.string().trim().min(1).max(60).optional(),
    receivedAt: z.string().datetime({ offset: true }).optional(),
    note: z.string().trim().max(500).optional(),
    items: z.array(purchaseItemBody).min(1).max(200),
  })
  .strict();
export type PurchaseInput = z.infer<typeof purchaseBody>;

export const purchasesQuery = paginationQuery;
export type PurchasesQuery = z.infer<typeof purchasesQuery>;
