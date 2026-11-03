/** Keys sellers must never receive (docs/ACCESS-MATRIX.md). Applied deeply to any response. */
export const FORBIDDEN_SELLER_KEYS = [
  'costPrice',
  'defaultCost',
  'unitCost',
  'margin',
  'marginPct',
  'profit',
  'stockValueCost',
  'cogs',
  'cost',
  'grossProfit',
  'valueAtCost',
] as const;

const FORBIDDEN = new Set<string>(FORBIDDEN_SELLER_KEYS);

export function stripCostFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripCostFields(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN.has(k)) continue;
      out[k] = stripCostFields(v);
    }
    return out as T;
  }
  return value;
}
