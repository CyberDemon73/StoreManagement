import { z } from 'zod';
import { paginationQuery, uuidSchema } from './common';
import { colorRef, INT4_MAX, money } from './products';

export const paymentMethods = ['CASH', 'CARD', 'WALLET', 'TRANSFER'] as const;
export const saleStatuses = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOID'] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d);
  }, 'Invalid date');

export const discountBody = z
  .object({
    type: z.enum(['PCT', 'AMOUNT']),
    /** PCT: 0–100 with at most 2 decimals. AMOUNT: minor units. */
    value: z.number().min(0).max(INT4_MAX),
  })
  .strict()
  .refine((d) => d.type !== 'PCT' || (d.value <= 100 && Math.round(d.value * 100) === d.value * 100), {
    message: 'Percentage must be 0–100 with at most 2 decimals',
    path: ['value'],
  })
  .refine((d) => d.type !== 'AMOUNT' || Number.isInteger(d.value), { message: 'Amount must be in minor units', path: ['value'] });

export const saleCreateBody = z
  .object({
    items: z
      .array(
        z
          .object({
            variantId: uuidSchema,
            qty: z.number().int().min(1).max(INT4_MAX),
            /** Managers only (sales.price.override). */
            unitPrice: money.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    discount: discountBody.optional(),
    paymentMethod: z.enum(paymentMethods),
    customerName: z.string().trim().max(80).optional(),
    customerPhone: z.string().trim().max(30).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type SaleCreateInput = z.infer<typeof saleCreateBody>;

export const salesQuery = paginationQuery
  .extend({
    from: isoDate.optional(),
    to: isoDate.optional(),
    sellerId: uuidSchema.optional(),
    paymentMethod: z.enum(paymentMethods).optional(),
    status: z.enum(saleStatuses).optional(),
    q: z.string().trim().max(100).optional(),
    productId: uuidSchema.optional(),
  })
  .strict();
export type SalesQuery = z.infer<typeof salesQuery>;

export const voidBody = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export type VoidInput = z.infer<typeof voidBody>;

export const returnBody = z
  .object({
    items: z
      .array(z.object({ saleItemId: uuidSchema, qty: z.number().int().min(1).max(INT4_MAX), restock: z.boolean() }).strict())
      .min(1)
      .max(100),
    refundMethod: z.enum(paymentMethods),
    reason: z.string().trim().min(1).max(500),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type ReturnInput = z.infer<typeof returnBody>;

export const receiptQuery = z.object({ format: z.enum(['json', 'html']).default('json') }).strict();

const cartLine = z
  .object({
    variantId: uuidSchema,
    productId: uuidSchema,
    productName: z.string().max(200),
    size: z.string().max(20),
    color: colorRef,
    sku: z.string().max(60),
    tint: z.string().max(7),
    unitPrice: money,
    qty: z.number().int().min(1).max(INT4_MAX),
    available: z.number().int().min(-INT4_MAX).max(INT4_MAX),
  })
  .strict();

/** Parked carts are a client convenience; totals are always recomputed at checkout. */
export const parkBody = z
  .object({
    label: z.string().trim().min(1).max(60),
    cart: z
      .object({
        lines: z.array(cartLine).max(100),
        discount: z.object({ type: z.enum(['PCT', 'AMOUNT']), value: z.number().min(0).max(INT4_MAX) }).strict(),
        paymentMethod: z.enum(paymentMethods),
        customerName: z.string().max(80).optional(),
        customerPhone: z.string().max(30).optional(),
        note: z.string().max(500).optional(),
      })
      .strict(),
  })
  .strict();
export type ParkInput = z.infer<typeof parkBody>;
