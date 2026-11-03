/**
 * Price fields take whole pounds (the store prices in whole EGP). Amounts stay integer minor
 * units everywhere else; an existing value with piastres is still shown exactly.
 */
export function moneyInputText(minor: number | undefined): string {
  if (minor === undefined) return '';
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

export function parseMoneyInput(text: string): number | undefined {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (cleaned === '') return undefined;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}
