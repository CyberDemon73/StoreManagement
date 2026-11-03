import type { SettingsRow } from '@/db/schema';

export interface SizePreset {
  name: string;
  sizes: string[];
}

/** Settings every authenticated user may see (sellers included). */
export interface PublicSettings {
  storeName: string;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  lowStockDefault: number;
  saleNumberPrefix: string;
  sellerDiscountCapPct: number;
  sizePresets: SizePreset[];
  colorPresets: { name: string; hex: string }[];
  receiptHeader: string | null;
  receiptFooter: string | null;
}

// The column is typed string[] from Sprint 0, but the stored shape is { name, sizes }[] (default []).
const sizePresetsOf = (s: SettingsRow) => s.sizePresets as unknown as SizePreset[];

export function toPublicSettings(s: SettingsRow): PublicSettings {
  return {
    storeName: s.storeName,
    logoUrl: s.logoUrl,
    phone: s.phone,
    address: s.address,
    currency: s.currency,
    timezone: s.timezone,
    lowStockDefault: s.lowStockDefault,
    saleNumberPrefix: s.saleNumberPrefix,
    sellerDiscountCapPct: Number(s.sellerDiscountCapPct),
    sizePresets: sizePresetsOf(s),
    colorPresets: s.colorPresets,
    receiptHeader: s.receiptHeader,
    receiptFooter: s.receiptFooter,
  };
}

/** Manager view (frontend `Settings`), minus lockoutEnabled/passwordRotationDays which are not stored. */
export interface FullSettings {
  storeName: string;
  logoUrl?: string;
  phone?: string;
  address?: string;
  currency: string;
  timezone: string;
  dateFormat: 'DD/MM/YYYY' | 'YYYY-MM-DD';
  lowStockDefault: number;
  saleNumberPrefix: string;
  nextSaleNumber: number;
  sellerDiscountCapPct: number;
  allowNegativeStock: boolean;
  requirePhoneOnTransfer: boolean;
  sizePresets: SizePreset[];
  colorPresets: { name: string; hex: string }[];
  receiptHeader?: string;
  receiptFooter?: string;
  receiptShowLogo: boolean;
  sessionIdleHours: number;
  sessionAbsoluteDays: number;
  largeRefundAlert: number;
}

const opt = (v: string | null) => v ?? undefined;

export function toFullSettings(s: SettingsRow, nextSaleNumber: number): FullSettings {
  return {
    storeName: s.storeName,
    logoUrl: opt(s.logoUrl),
    phone: opt(s.phone),
    address: opt(s.address),
    currency: s.currency,
    timezone: s.timezone,
    dateFormat: s.dateFormat === 'YYYY-MM-DD' ? 'YYYY-MM-DD' : 'DD/MM/YYYY',
    lowStockDefault: s.lowStockDefault,
    saleNumberPrefix: s.saleNumberPrefix,
    nextSaleNumber,
    sellerDiscountCapPct: Number(s.sellerDiscountCapPct),
    allowNegativeStock: s.allowNegativeStock,
    requirePhoneOnTransfer: s.requirePhoneOnTransfer,
    sizePresets: sizePresetsOf(s),
    colorPresets: s.colorPresets,
    receiptHeader: opt(s.receiptHeader),
    receiptFooter: opt(s.receiptFooter),
    receiptShowLogo: s.receiptShowLogo,
    sessionIdleHours: s.sessionIdleHours,
    sessionAbsoluteDays: s.sessionAbsoluteDays,
    largeRefundAlert: s.largeRefundAlert,
  };
}
