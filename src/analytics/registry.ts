import type { ZodType } from 'zod';
import type { Db } from '@/db/client';

/**
 * Reports exportable as CSV via GET /analytics/export?report=<name>&<the report's own query>.
 * `rows` flattens the report into one object per CSV row (same numbers as the JSON endpoint).
 */
export interface ReportDef {
  query: ZodType<Record<string, unknown>>;
  rows: (db: Db, q: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
}

export const REPORTS: Record<string, ReportDef> = {
  // --- task 2: kpis / trend / payment mix ---
  // --- task 3: brands / categories / top products / top variants / size-color ---
  // --- task 4: slow movers / stock ageing / sellers / returns / price list ---
};
