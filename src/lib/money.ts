// Money is stored as integer minor units (CLAUDE.md rule 2). These helpers convert to and from
// the major-unit text used in CSV files ("1090.50"), string-based so no float ever touches a
// stored amount. Two decimals (EGP piastres) — see docs/DECISIONS.md.

const INT4_MAX = 2_147_483_647;
const MAJOR = /^(\d{1,8})(?:\.(\d{1,2}))?$/;

/** "1090", "1090.5", "1090.50" → 109050. Returns null for anything else (negatives, "1,090", "abc"). */
export function parseMajor(text: string): number | null {
  const m = MAJOR.exec(text.trim());
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return minor <= INT4_MAX ? minor : null;
}

/** 109050 → "1090.50"; no grouping, no currency, for machine-readable files. */
export function formatMajor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
