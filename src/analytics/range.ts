import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { AppError } from '@/lib/errors';
import { getSettings } from '@/services/settings';

export const MAX_RANGE_DAYS = 366;

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d);
  }, 'Invalid date');

/** Required local date range (store timezone), `to` inclusive. */
export const rangeQuery = z.object({ from: isoDate, to: isoDate }).strict();

export interface AnalyticsRange {
  from: string;
  to: string;
  tz: string;
  /** timestamptz of local midnight starting `from`. */
  start: SQL;
  /** timestamptz of local midnight after `to` (exclusive bound). */
  end: SQL;
  days: number;
}

const DAY_MS = 86_400_000;
const dayIndex = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY_MS;
const fromIndex = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

function build(from: string, to: string, tz: string): AnalyticsRange {
  return {
    from,
    to,
    tz,
    start: sql`((${from})::date)::timestamp at time zone ${tz}`,
    end: sql`((${to})::date + 1)::timestamp at time zone ${tz}`,
    days: dayIndex(to) - dayIndex(from) + 1,
  };
}

/**
 * Turn local dates into SQL instants in the store timezone (CLAUDE.md rule 8).
 * Validation errors surface as 400 VALIDATION with per-field messages.
 */
export async function resolveRange(db: Db, q: { from: string; to: string }): Promise<AnalyticsRange> {
  const parsed = rangeQuery.safeParse(q);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || '_'] = issue.message;
    throw new AppError('VALIDATION', 'Invalid date range', { fields });
  }
  const { from, to } = parsed.data;
  if (dayIndex(to) < dayIndex(from)) throw new AppError('VALIDATION', 'Invalid date range', { fields: { to: '`to` must not be before `from`' } });
  if (dayIndex(to) - dayIndex(from) + 1 > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION', 'Invalid date range', { fields: { to: `Range is limited to ${MAX_RANGE_DAYS} days` } });
  }
  const { timezone } = await getSettings(db);
  return build(from, to, timezone);
}

/** The period of the same length immediately before `r` (for deltas). */
export function previousRange(r: AnalyticsRange): AnalyticsRange {
  const len = r.days;
  return build(fromIndex(dayIndex(r.from) - len), fromIndex(dayIndex(r.from) - 1), r.tz);
}

/** Bounds for optional list filters (sales, movements): either side may be absent. */
export async function localDayBounds(db: Db, from?: string, to?: string): Promise<{ start?: SQL; end?: SQL }> {
  if (!from && !to) return {};
  const { timezone } = await getSettings(db);
  return {
    start: from ? sql`((${from})::date)::timestamp at time zone ${timezone}` : undefined,
    end: to ? sql`((${to})::date + 1)::timestamp at time zone ${timezone}` : undefined,
  };
}
