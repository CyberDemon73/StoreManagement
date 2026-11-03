import type { ColorRef } from '@/types';

/** Everyday clothing colours offered in every colour picker, after the store's own presets. */
export const COMMON_COLORS: ColorRef[] = [
  { name: 'Black', hex: '#111111' },
  { name: 'White', hex: '#F5F5F2' },
  { name: 'Off White', hex: '#EDE8DC' },
  { name: 'Grey', hex: '#8E9196' },
  { name: 'Charcoal', hex: '#3C3F44' },
  { name: 'Navy', hex: '#1F2A44' },
  { name: 'Blue', hex: '#2F5DA8' },
  { name: 'Light Blue', hex: '#9CC3E6' },
  { name: 'Beige', hex: '#D8C7A6' },
  { name: 'Khaki', hex: '#B5A27A' },
  { name: 'Camel', hex: '#B9874E' },
  { name: 'Brown', hex: '#6B4428' },
  { name: 'Olive', hex: '#5E6B3A' },
  { name: 'Green', hex: '#2F7A4B' },
  { name: 'Burgundy', hex: '#6D1F2E' },
  { name: 'Red', hex: '#C62F2F' },
  { name: 'Pink', hex: '#E7A1B5' },
  { name: 'Orange', hex: '#E07A2E' },
  { name: 'Yellow', hex: '#E8C547' },
  { name: 'Purple', hex: '#6A4C93' },
];

/** Store presets first, then common colours, then anything already on the product; one per name. */
export function colorChoices(presets: ColorRef[], selected: ColorRef[]): ColorRef[] {
  const out = new Map<string, ColorRef>();
  for (const c of [...presets, ...COMMON_COLORS, ...selected]) {
    const key = c.name.trim().toLowerCase();
    if (!out.has(key)) out.set(key, c);
  }
  return [...out.values()];
}
