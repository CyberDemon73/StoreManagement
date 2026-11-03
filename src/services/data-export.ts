import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { strToU8, zipSync } from 'fflate';
import type { Db } from '@/db/client';
import {
  auditLog,
  brands,
  categories,
  notifications,
  parkedSales,
  products,
  purchaseItems,
  purchases,
  returnItems,
  returns,
  saleCounters,
  saleItems,
  sales,
  settings,
  stockCountItems,
  stockCounts,
  stockMovements,
  suppliers,
  users,
  variants,
} from '@/db/schema';
import { toCsv } from '@/lib/csv';

interface ExportSpec {
  table: PgTable;
  /** DB column names never written to the export. */
  omit?: string[];
}

const SPECS: ExportSpec[] = [
  { table: settings },
  { table: users, omit: ['password_hash'] },
  { table: brands },
  { table: categories },
  { table: suppliers },
  { table: products },
  { table: variants },
  { table: stockMovements },
  { table: saleCounters },
  { table: purchases },
  { table: purchaseItems },
  { table: stockCounts },
  { table: stockCountItems },
  { table: sales },
  { table: saleItems },
  { table: returns },
  { table: returnItems },
  { table: parkedSales },
  { table: notifications },
  { table: auditLog },
];

export const EXPORTED_TABLES: readonly string[] = SPECS.map((s) => getTableName(s.table));

/** Credentials, device fingerprints and transient replay/lockout state: not business data. */
export const EXCLUDED_TABLES: readonly string[] = ['sessions', 'password_reset_tokens', 'idempotency_keys', 'failed_logins', 'known_devices'];

function cellValue(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

async function tableCsv(db: Db, spec: ExportSpec): Promise<{ csv: string; count: number }> {
  const omit = new Set(spec.omit ?? []);
  // [jsKey, dbColumnName]; the export uses DB names so it reads like the schema docs.
  const cols = Object.entries(getTableColumns(spec.table))
    .filter(([, c]) => !omit.has(c.name))
    .map(([key, c]) => [key, c.name] as const);
  const rows = (await db.select().from(spec.table)) as Record<string, unknown>[];
  if (rows.length === 0) return { csv: `﻿${cols.map(([, name]) => name).join(',')}\r\n`, count: 0 };
  const out = rows.map((r) => Object.fromEntries(cols.map(([key, name]) => [name, cellValue(r[key])])));
  return { csv: toCsv(out, { bom: true }), count: rows.length };
}

/** Zip of one CSV per business table (docs/plans/sprint-6.md). Whole tables in memory: fine at single-store scale. */
export async function buildDataExport(db: Db): Promise<{ zip: Uint8Array; tables: Record<string, number> }> {
  const files: Record<string, Uint8Array> = {};
  const tables: Record<string, number> = {};
  for (const spec of SPECS) {
    const name = getTableName(spec.table);
    const { csv, count } = await tableCsv(db, spec);
    files[`${name}.csv`] = strToU8(csv);
    tables[name] = count;
  }
  return { zip: zipSync(files, { level: 6 }), tables };
}
