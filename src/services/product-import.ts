import { asc, sql } from 'drizzle-orm';
import Papa from 'papaparse';
import type { Db } from '@/db/client';
import { brands, categories, products, variants } from '@/db/schema';
import { audit } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { parseMajor } from '@/lib/money';
import { buildSku, defaultBaseSku, skuPart } from '@/lib/sku';
import { DEFAULT_TINT } from '@/serializers/catalog';
import { actorOf, mapUniqueViolation } from './products';
import { getSettings } from './settings';
import { applyMovement } from './stock';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
const MAX_QTY = 1_000_000;
const INSERT_CHUNK = 500;

const REQUIRED = ['name', 'brand', 'category', 'size', 'color', 'price'] as const;
const COLUMNS = [...REQUIRED, 'colorHex', 'cost', 'qty', 'barcode'] as const;
type Column = (typeof COLUMNS)[number];
const COLUMN_BY_LOWER = new Map<string, Column>(COLUMNS.map((c) => [c.toLowerCase(), c]));

export type ImportRowData = Partial<Record<Column, string>>;

export interface ImportRowError {
  row: number;
  message: string;
  data: ImportRowData;
}

export interface ImportReport {
  rows: number;
  ok: number;
  errors: ImportRowError[];
}

export interface ImportCommitted extends ImportReport {
  created: { products: number; variants: number };
}

export type ImportOutcome = { kind: 'preview'; report: ImportReport } | { kind: 'rejected'; report: ImportReport } | { kind: 'committed'; result: ImportCommitted };

interface ParsedRow {
  /** Record number as a spreadsheet shows it: the header is row 1. */
  row: number;
  data: ImportRowData;
}

function badFile(message: string): AppError {
  return new AppError('VALIDATION', 'Invalid file', { fields: { file: message } });
}

/** Bytes → text. NUL bytes or invalid UTF-8 mean a binary upload (xlsx, zip, image), not a CSV. */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw badFile('Must be a text CSV file (UTF-8)');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    throw badFile('Must be a text CSV file (UTF-8)');
  }
}

// Undo our own export's formula neutralisation ("'=x" → "=x") so an export round-trips.
// The text is stored as data and neutralised again on every export.
const NEUTRALISED = /^'(?=\s*[=+\-@\t\r])/;

function cleanCell(value: string | undefined): string {
  return (value ?? '').trim().replace(NEUTRALISED, '');
}

/** CSV text → header-mapped rows. Structural problems (columns, size, quoting) reject the whole file. */
export function parseImportCsv(text: string): ParsedRow[] {
  // `preview` bounds the work on a hostile file: header + one row past the limit is enough to reject.
  const parsed = Papa.parse<string[]>(text, { delimiter: ',', skipEmptyLines: 'greedy', preview: MAX_IMPORT_ROWS + 2 });
  const quoteError = parsed.errors.find((e) => e.type === 'Quotes');
  if (quoteError) throw badFile(`Malformed CSV (unbalanced quotes) near row ${(quoteError.row ?? 0) + 1}`);

  const [header, ...records] = parsed.data;
  if (!header) throw badFile('The file is empty');
  const index = new Map<Column, number>();
  header.forEach((h, i) => {
    const col = COLUMN_BY_LOWER.get(h.trim().replace(/^﻿/, '').toLowerCase());
    if (col && !index.has(col)) index.set(col, i);
  });
  const missing = REQUIRED.filter((c) => !index.has(c));
  if (missing.length > 0) throw badFile(`Missing columns: ${missing.join(', ')}`);
  if (records.length === 0) throw badFile('The file has no rows');
  if (records.length > MAX_IMPORT_ROWS) throw badFile(`At most ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows per file`);

  return records.map((cells, i) => {
    const data: ImportRowData = {};
    for (const [col, at] of index) data[col] = cleanCell(cells[at]).slice(0, 500);
    return { row: i + 2, data };
  });
}

interface ExistingProduct {
  id: string;
  baseSku: string;
  defaultCost: number | null;
}

interface Context {
  brandByName: Map<string, string>;
  categoriesByName: Map<string, string[]>;
  productByKey: Map<string, ExistingProduct>;
  baseSkus: Set<string>;
  variantKeys: Set<string>;
  skus: Set<string>;
  barcodes: Set<string>;
  hexByColor: Map<string, string>;
}

async function loadContext(db: Db): Promise<Context> {
  const [brandRows, categoryRows, productRows, variantRows] = await Promise.all([
    db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.createdAt)),
    db.select({ id: categories.id, name: categories.name }).from(categories),
    db
      .select({ id: products.id, name: products.name, brandId: products.brandId, baseSku: products.baseSku, defaultCost: products.defaultCost })
      .from(products)
      .orderBy(asc(products.createdAt), asc(products.id)),
    db
      .select({ productId: variants.productId, size: variants.size, colorName: variants.colorName, colorHex: variants.colorHex, sku: variants.sku, barcode: variants.barcode })
      .from(variants)
      .orderBy(asc(variants.createdAt)),
  ]);
  const ctx: Context = {
    brandByName: new Map(),
    categoriesByName: new Map(),
    productByKey: new Map(),
    baseSkus: new Set(productRows.map((p) => p.baseSku.toUpperCase())),
    variantKeys: new Set(variantRows.map((v) => variantKey(v.productId, v.size, v.colorName))),
    skus: new Set(variantRows.map((v) => v.sku.toUpperCase())),
    barcodes: new Set(variantRows.flatMap((v) => (v.barcode ? [v.barcode] : []))),
    hexByColor: new Map(),
  };
  for (const b of brandRows) if (!ctx.brandByName.has(b.name.toLowerCase())) ctx.brandByName.set(b.name.toLowerCase(), b.id);
  for (const c of categoryRows) {
    const key = c.name.toLowerCase();
    ctx.categoriesByName.set(key, [...(ctx.categoriesByName.get(key) ?? []), c.id]);
  }
  for (const p of productRows) {
    const key = productKey(p.brandId, p.name);
    if (!ctx.productByKey.has(key)) ctx.productByKey.set(key, { id: p.id, baseSku: p.baseSku, defaultCost: p.defaultCost });
  }
  for (const v of variantRows) if (!ctx.hexByColor.has(v.colorName.toLowerCase())) ctx.hexByColor.set(v.colorName.toLowerCase(), v.colorHex);
  return ctx;
}

const productKey = (brandId: string, name: string) => `${brandId}|${name.toLowerCase()}`;
// Compared on SKU parts: "M"/"m" or "Navy Blue"/"navyblue" are the same cell for the SKU.
const variantKey = (productId: string, size: string, color: string) => `${productId}|${skuPart(size)}|${skuPart(color)}`;

interface PlannedVariant {
  size: string;
  colorName: string;
  colorHex: string;
  sku: string;
  barcode: string | null;
  sellPrice: number;
  costPrice: number | null;
  qty: number;
}

interface PlannedProduct {
  existingId: string | null;
  name: string;
  brandId: string;
  categoryId: string;
  baseSku: string;
  defaultPrice: number;
  defaultCost: number | null;
  variants: PlannedVariant[];
}

interface Plan {
  report: ImportReport;
  products: PlannedProduct[];
}

/** "NO-OXF", then "NO-OXF2", "NO-OXF3"… — never a "-n" suffix, which would read like a variant part. */
function uniqueBaseSku(brandName: string, name: string, taken: Set<string>): string {
  const base = defaultBaseSku(brandName, name);
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base}${n}`;
  taken.add(candidate);
  return candidate;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function checkLength(value: string, label: string, max: number): string | null {
  if (!value) return `${label} is required`;
  if (value.length > max) return `${label} is too long (max ${max})`;
  return null;
}

/** Validate every row against the catalogue; the plan is only meaningful when report.errors is empty. */
function planImport(rows: ParsedRow[], ctx: Context): Plan {
  const errors: ImportRowError[] = [];
  const groups = new Map<string, PlannedProduct>();
  const seenKeys = new Set<string>();
  const seenBarcodes = new Set<string>();
  const brandNameById = new Map([...ctx.brandByName].map(([name, id]) => [id, name]));

  // A colour without a hex reuses the catalogue's hex for that name, else the file's, else neutral.
  for (const { data } of rows) {
    const color = (data.color ?? '').toLowerCase();
    if (color && HEX.test(data.colorHex ?? '') && !ctx.hexByColor.has(color)) ctx.hexByColor.set(color, data.colorHex!);
  }

  for (const { row, data } of rows) {
    const fail = (message: string) => errors.push({ row, message, data });
    const name = data.name ?? '';
    const size = data.size ?? '';
    const color = data.color ?? '';
    const hexText = data.colorHex ?? '';
    const costText = data.cost ?? '';
    const qtyText = data.qty ?? '';
    const barcode = data.barcode ?? '';

    const lengthError = checkLength(name, 'Name', 200) ?? checkLength(size, 'Size', 20) ?? checkLength(color, 'Color', 30);
    if (lengthError) {
      fail(lengthError);
      continue;
    }
    if (!data.brand) {
      fail('Brand is required');
      continue;
    }
    const brandId = ctx.brandByName.get(data.brand.toLowerCase());
    if (!brandId) {
      fail('Unknown brand');
      continue;
    }
    if (!data.category) {
      fail('Category is required');
      continue;
    }
    const categoryIds = ctx.categoriesByName.get(data.category.toLowerCase()) ?? [];
    if (categoryIds.length === 0) {
      fail('Unknown category');
      continue;
    }
    if (categoryIds.length > 1) {
      fail('Ambiguous category (several share this name)');
      continue;
    }
    if (!skuPart(size) || !skuPart(color)) {
      fail('Size and color need letters or digits');
      continue;
    }
    if (hexText && !HEX.test(hexText)) {
      fail('Color hex must be #rrggbb');
      continue;
    }
    if (!data.price) {
      fail('Price is required');
      continue;
    }
    const price = parseMajor(data.price);
    if (price === null) {
      fail('Price not a number');
      continue;
    }
    const cost = costText ? parseMajor(costText) : null;
    if (costText && cost === null) {
      fail('Cost not a number');
      continue;
    }
    if (qtyText && !/^\d+$/.test(qtyText)) {
      fail('Qty must be a whole number ≥ 0');
      continue;
    }
    const qty = qtyText ? Number(qtyText) : 0;
    if (qty > MAX_QTY) {
      fail(`Qty too large (max ${MAX_QTY.toLocaleString('en-US')})`);
      continue;
    }
    if (barcode && (barcode.length < 4 || barcode.length > 32)) {
      fail('Barcode must be 4–32 characters');
      continue;
    }

    const key = productKey(brandId, name);
    const existing = ctx.productByKey.get(key);
    let group = groups.get(key);
    if (!group) {
      group = existing
        ? { existingId: existing.id, name, brandId, categoryId: categoryIds[0]!, baseSku: existing.baseSku, defaultPrice: price, defaultCost: existing.defaultCost, variants: [] }
        : {
            existingId: null,
            name,
            brandId,
            categoryId: categoryIds[0]!,
            baseSku: uniqueBaseSku(brandNameById.get(brandId) ?? data.brand, name, ctx.baseSkus),
            defaultPrice: price,
            defaultCost: cost,
            variants: [],
          };
      groups.set(key, group);
    }

    const cellKey = variantKey(existing?.id ?? `new:${key}`, size, color);
    if (existing && ctx.variantKeys.has(cellKey)) {
      fail('Variant already exists');
      continue;
    }
    if (seenKeys.has(cellKey)) {
      fail('Duplicate variant in file');
      continue;
    }
    const sku = buildSku(group.baseSku, size, color);
    if (ctx.skus.has(sku.toUpperCase())) {
      fail('SKU already exists');
      continue;
    }
    if (barcode && ctx.barcodes.has(barcode)) {
      fail('Barcode already exists');
      continue;
    }
    if (barcode && seenBarcodes.has(barcode)) {
      fail('Duplicate barcode in file');
      continue;
    }
    seenKeys.add(cellKey);
    if (barcode) seenBarcodes.add(barcode);
    group.variants.push({
      size,
      colorName: color,
      colorHex: hexText || ctx.hexByColor.get(color.toLowerCase()) || DEFAULT_TINT,
      sku,
      barcode: barcode || null,
      sellPrice: price,
      costPrice: cost ?? group.defaultCost,
      qty,
    });
  }

  return {
    report: { rows: rows.length, ok: rows.length - errors.length, errors },
    products: [...groups.values()].filter((g) => g.variants.length > 0),
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Validate (and, unless dryRun, write) a product CSV. All-or-nothing: the commit re-validates
 * inside its transaction and writes only when every row is clean. Opening quantities go through
 * applyMovement() as INITIAL movements, like product creation.
 */
export async function importProducts(db: Db, user: AuthUser, bytes: Uint8Array, opts: { dryRun: boolean }, reqCtx: ReqCtx): Promise<ImportOutcome> {
  const rows = parseImportCsv(decodeCsv(bytes));
  if (opts.dryRun) {
    const { report } = planImport(rows, await loadContext(db));
    return { kind: 'preview', report };
  }

  return db.transaction(async (tx): Promise<ImportOutcome> => {
    const plan = planImport(rows, await loadContext(tx));
    if (plan.report.errors.length > 0) return { kind: 'rejected', report: plan.report };

    const fresh = plan.products.filter((p) => !p.existingId);
    const idByBaseSku = new Map<string, string>();
    try {
      for (const batch of chunks(fresh, INSERT_CHUNK)) {
        const inserted = await tx
          .insert(products)
          .values(
            batch.map((p) => ({
              name: p.name,
              brandId: p.brandId,
              categoryId: p.categoryId,
              baseSku: p.baseSku,
              defaultPrice: p.defaultPrice,
              defaultCost: p.defaultCost,
              createdBy: user.id,
            })),
          )
          .returning({ id: products.id, baseSku: products.baseSku });
        for (const r of inserted) idByBaseSku.set(r.baseSku, r.id);
      }
    } catch (err) {
      mapUniqueViolation(err);
    }

    const { lowStockDefault } = await getSettings(tx);
    const cells = plan.products.flatMap((p) => {
      const productId = p.existingId ?? idByBaseSku.get(p.baseSku);
      if (!productId) throw new Error('imported product id missing');
      return p.variants.map((v) => ({ productId, v }));
    });
    let variantCount = 0;
    try {
      for (const batch of chunks(cells, INSERT_CHUNK)) {
        // clock_timestamp() keeps file order as matrix (createdAt) order within the transaction.
        const inserted = await tx
          .insert(variants)
          .values(
            batch.map(({ productId, v }) => ({
              productId,
              size: v.size,
              colorName: v.colorName,
              colorHex: v.colorHex,
              sku: v.sku,
              barcode: v.barcode,
              sellPrice: v.sellPrice,
              costPrice: v.costPrice,
              lowStockThreshold: lowStockDefault,
              createdAt: sql`clock_timestamp()`,
              updatedAt: sql`clock_timestamp()`,
            })),
          )
          .returning({ id: variants.id, sku: variants.sku });
        variantCount += inserted.length;
        const idBySku = new Map(inserted.map((r) => [r.sku, r.id]));
        for (const { v } of batch) {
          const variantId = idBySku.get(v.sku);
          if (v.qty <= 0 || !variantId) continue;
          await applyMovement(tx, { variantId, type: 'INITIAL', qtyDelta: v.qty, unitCost: v.costPrice, reason: 'CSV import', userId: user.id });
        }
      }
    } catch (err) {
      mapUniqueViolation(err);
    }

    const created = { products: fresh.length, variants: variantCount };
    await audit(tx, actorOf(user, reqCtx), 'products.import', 'product', null, null, {
      rows: plan.report.rows,
      created,
      productIds: [...idByBaseSku.values()],
      updatedProductIds: plan.products.flatMap((p) => (p.existingId ? [p.existingId] : [])),
    });
    return { kind: 'committed', result: { ...plan.report, created } };
  });
}
