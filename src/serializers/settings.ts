import type { SettingsRow } from '@/db/schema';

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
  sizePresets: string[];
  colorPresets: { name: string; hex: string }[];
  receiptHeader: string | null;
  receiptFooter: string | null;
}

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
    sizePresets: s.sizePresets,
    colorPresets: s.colorPresets,
    receiptHeader: s.receiptHeader,
    receiptFooter: s.receiptFooter,
  };
}
