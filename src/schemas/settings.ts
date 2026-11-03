import { z } from 'zod';
import { colorRef, money } from './products';

const text500 = z.string().trim().max(500).nullable();

/** Two decimal places at most; tolerant of binary float noise (12.34 * 100 = 1233.9999…). */
const twoDp = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9;

export const sizePreset = z
  .object({
    name: z.string().trim().min(1).max(30),
    sizes: z.array(z.string().trim().min(1).max(20)).min(1).max(30),
  })
  .strict();

/**
 * Every writable setting. Read-only or unsupported keys (`nextSaleNumber`, `lockoutEnabled`,
 * `passwordRotationDays`) are rejected by `.strict()`. The timezone is checked against
 * pg_timezone_names in the service, because only Postgres knows what it can convert.
 */
export const settingsPatchBody = z
  .object({
    storeName: z.string().trim().min(1).max(100),
    logoUrl: z
      .string()
      .trim()
      .max(500)
      .url()
      .refine((u) => u.startsWith('https://'), 'Logo URL must use https')
      .nullable(),
    phone: text500,
    address: text500,
    currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO code'),
    timezone: z.string().min(1).max(64),
    dateFormat: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD']),
    lowStockDefault: z.number().int().min(0).max(1000),
    // The sale number contract (DECISIONS 2026-11-05): A–Z only, and never a purchase/count prefix.
    saleNumberPrefix: z
      .string()
      .regex(/^[A-Z]{1,6}$/, 'Use 1–6 uppercase letters')
      .refine((p) => p !== 'PO' && p !== 'SC', 'PO and SC are reserved'),
    sellerDiscountCapPct: z.number().min(0).max(100).refine(twoDp, 'At most 2 decimal places'),
    allowNegativeStock: z.boolean(),
    requirePhoneOnTransfer: z.boolean(),
    receiptHeader: text500,
    receiptFooter: text500,
    receiptShowLogo: z.boolean(),
    sessionIdleHours: z.number().int().min(1).max(72),
    sessionAbsoluteDays: z.number().int().min(1).max(90),
    largeRefundAlert: money,
    sizePresets: z.array(sizePreset).max(20),
    colorPresets: z.array(colorRef).max(60),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export type SettingsPatchInput = z.infer<typeof settingsPatchBody>;
