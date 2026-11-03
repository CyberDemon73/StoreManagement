import { and, asc, eq, getTableColumns, getTableName, gt, or, type SQL } from 'drizzle-orm';
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { strToU8, Zip, ZipDeflate } from 'fflate';
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

export const EXPORT_PAGE_SIZE = 1000;

type Row = Record<string, unknown>;

/** [jsKey, column] for the primary key, single-column or composite. */
function primaryKey(table: PgTable): [string, PgColumn][] {
  const cols = Object.entries(getTableColumns(table)) as [string, PgColumn][];
  const single = cols.filter(([, c]) => c.primary);
  if (single.length > 0) return single;
  const composite = getTableConfig(table).primaryKeys[0];
  if (!composite) throw new Error(`data export: ${getTableName(table)} has no primary key`);
  // getTableConfig rebuilds column objects, so match by DB name rather than identity.
  return composite.columns.map((pc) => {
    const found = cols.find(([, c]) => c.name === pc.name);
    if (!found) throw new Error(`data export: primary key column ${pc.name} not found`);
    return found;
  });
}

/** Row-value `(a, b, c) > (x, y, z)` spelled out so each value is encoded by its own column. */
function after(pk: [string, PgColumn][], last: Row): SQL {
  const branches = pk.map(([key, col], i) =>
    and(...pk.slice(0, i).map(([k, c]) => eq(c, last[k])), gt(col, last[key])),
  );
  return or(...branches)!;
}

/**
 * Keyset pagination by primary key: constant cost per page and no OFFSET drift, so a large
 * audit_log never sits in memory at once.
 */
export async function* keysetPages(db: Db, table: PgTable, pageSize = EXPORT_PAGE_SIZE): AsyncGenerator<Row[]> {
  const pk = primaryKey(table);
  const order = pk.map(([, c]) => asc(c));
  let last: Row | null = null;
  for (;;) {
    const base = db.select().from(table);
    const filtered = last ? base.where(after(pk, last)) : base;
    const page = (await filtered.orderBy(...order).limit(pageSize)) as Row[];
    if (page.length > 0) yield page;
    if (page.length < pageSize) return;
    last = page[page.length - 1]!;
  }
}

function cellValue(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

const BOM = String.fromCharCode(0xfeff);

export interface ExportSummary {
  tables: Record<string, number>;
  bytes: number;
  /** False when the reader cancelled (client abort) or production failed part-way. */
  completed: boolean;
}

/**
 * Zip of one CSV per business table (docs/plans/sprint-6.md), produced as a stream: rows are read
 * a page at a time and deflated as they arrive, so neither the tables nor the zip are ever held
 * whole (Vercel caps non-streamed responses at 4.5 MB). `onFinish` runs exactly once: after the
 * last byte and before the stream closes, or on cancel/error with the partial counts.
 */
export function streamDataExport(db: Db, opts: { onFinish?: (summary: ExportSummary) => Promise<void> } = {}): ReadableStream<Uint8Array> {
  const queue: Uint8Array[] = [];
  let zipError: Error | null = null;
  let finished = false;
  const zip = new Zip((err, chunk, final) => {
    if (err) zipError = err;
    else if (chunk.byteLength > 0) queue.push(chunk);
    if (final) finished = true;
  });
  const tables: Record<string, number> = {};
  let bytes = 0;
  let reported = false;
  const report = async (completed: boolean) => {
    if (reported) return;
    reported = true;
    await opts.onFinish?.({ tables: { ...tables }, bytes, completed });
  };

  async function* produce(): AsyncGenerator<Uint8Array> {
    const drain = function* () {
      if (zipError) throw zipError;
      while (queue.length > 0) {
        const c = queue.shift()!;
        bytes += c.byteLength;
        yield c;
      }
    };
    for (const spec of SPECS) {
      const name = getTableName(spec.table);
      const omit = new Set(spec.omit ?? []);
      // [jsKey, dbColumnName]; the export uses DB names so it reads like the schema docs.
      const cols = Object.entries(getTableColumns(spec.table))
        .filter(([, c]) => !omit.has(c.name))
        .map(([key, c]) => [key, c.name] as const);
      const file = new ZipDeflate(`${name}.csv`, { level: 6 });
      zip.add(file);
      // BOM so Excel reads UTF-8 (Arabic names); header once per file, even for empty tables.
      file.push(strToU8(`${BOM}${cols.map(([, n]) => n).join(',')}\r\n`));
      let count = 0;
      for await (const page of keysetPages(db, spec.table)) {
        const out = page.map((r) => Object.fromEntries(cols.map(([key, n]) => [n, cellValue(r[key])])));
        const csv = toCsv(out);
        // toCsv repeats the header per call; drop it (column names never contain a line break).
        file.push(strToU8(csv.slice(csv.indexOf('\r\n') + 2)));
        count += page.length;
        yield* drain();
      }
      file.push(new Uint8Array(0), true);
      tables[name] = count;
      yield* drain();
    }
    zip.end();
    yield* drain();
    if (!finished) throw new Error('data export: zip did not finalise');
    await report(true);
  }

  const it = produce();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
        await report(false).catch(() => undefined);
      }
    },
    async cancel() {
      await it.return(undefined);
      await report(false);
    },
  });
}

/** Collects the streamed export (weekly backup, tests). The zip is compressed; rows were still paged. */
export async function buildDataExport(db: Db): Promise<{ zip: Uint8Array; tables: Record<string, number> }> {
  let tables: Record<string, number> = {};
  const stream = streamDataExport(db, {
    onFinish: async (s) => {
      tables = s.tables;
    },
  });
  const zip = new Uint8Array(await new Response(stream).arrayBuffer());
  return { zip, tables };
}
