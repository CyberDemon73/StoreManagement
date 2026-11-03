// RFC 4180 CSV with spreadsheet-formula neutralisation (docs/SECURITY.md: CSV export escapes
// formula-leading cells). A text cell whose first non-space character is = + - @ tab or CR is
// prefixed with a single quote, and so is any such character right after a ';' — Excel in
// European/Arabic locales uses ';' as the list separator, so "x;=1+1" would otherwise become a
// live formula cell. Numbers are written as-is so negative amounts stay numeric.

const FORMULA_START = /^(\s*)([=+\-@\t\r])/;
const AFTER_SEMICOLON = /;(\s*)([=+\-@\t\r])/g;

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  s = s.replace(AFTER_SEMICOLON, ";$1'$2");
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV text. Columns come from the first row's keys, in order. `bom` helps Excel read UTF-8 (Arabic names). */
export function toCsv(rows: Record<string, unknown>[], opts: { bom?: boolean } = {}): string {
  const first = rows[0];
  if (!first) return '';
  const columns = Object.keys(first);
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return (opts.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}
