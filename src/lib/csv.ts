// RFC 4180 CSV with spreadsheet-formula neutralisation (docs/SECURITY.md: CSV export escapes
// formula-leading cells). Text starting with = + - @ tab or CR is prefixed with a single quote;
// numbers are written as-is so negative amounts stay numeric.

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV text. Columns come from the first row's keys, in order. */
export function toCsv(rows: Record<string, unknown>[]): string {
  const first = rows[0];
  if (!first) return '';
  const columns = Object.keys(first);
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}
