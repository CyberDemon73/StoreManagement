import type { Settings } from '@/types';

export const SECTIONS = ['store', 'localization', 'inventory', 'sales', 'receipt', 'security', 'data', 'appearance'] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = { store: 'Store', localization: 'Localization', inventory: 'Inventory', sales: 'Sales', receipt: 'Receipt', security: 'Security', data: 'Data', appearance: 'Appearance' };

/** Which settings keys each section edits — used for the "Unsaved changes in …" hint. */
export const SECTION_KEYS: Record<Section, (keyof Settings)[]> = {
  store: ['storeName', 'logoUrl', 'phone', 'address'],
  localization: ['currency', 'timezone', 'dateFormat'],
  inventory: ['lowStockDefault', 'sizePresets', 'colorPresets'],
  sales: ['saleNumberPrefix', 'sellerDiscountCapPct', 'allowNegativeStock', 'requirePhoneOnTransfer'],
  receipt: ['receiptHeader', 'receiptFooter', 'receiptShowLogo'],
  security: ['sessionIdleHours', 'passwordRotationDays', 'lockoutEnabled'],
  data: [],
  appearance: [],
};

export interface SectionProps {
  draft: Settings;
  patch: (p: Partial<Settings>) => void;
}

export function isSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Keys whose draft value differs from the saved one. */
export function dirtyKeys(saved: Settings, draft: Settings): (keyof Settings)[] {
  return (Object.keys(draft) as (keyof Settings)[]).filter((k) => !isSame(saved[k], draft[k]));
}
