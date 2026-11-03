import { count, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/products/import/route';
import { getDb } from '@/db/client';
import { auditLog, products, stockMovements, variants } from '@/db/schema';
import { createProductDirect, createVariantDirect, seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

const HEADER = 'name,brand,category,size,color,colorHex,price,cost,qty,barcode';

async function fixture(role: 'MANAGER' | 'SELLER' | 'ADMIN' = 'MANAGER') {
  const db = getDb();
  const cat = await seedCatalog(db); // brand "Northline", category "Tops"
  const user = await createUser(db, { role });
  const cookie = await sessionCookieFor(db, user.id);
  return { db, ...cat, user, cookie };
}

function csvForm(text: string | Uint8Array<ArrayBuffer>, name = 'import.csv'): FormData {
  const form = new FormData();
  form.append('file', new File([text], name, { type: 'text/csv' }));
  return form;
}

function upload(cookie: string, text: string | Uint8Array<ArrayBuffer>, query = '?dryRun=1') {
  return call(POST, { method: 'POST', path: `/api/v1/products/import${query}`, cookie, form: csvForm(text) });
}

async function counts() {
  const db = getDb();
  const [p] = await db.select({ n: count() }).from(products);
  const [v] = await db.select({ n: count() }).from(variants);
  const [m] = await db.select({ n: count() }).from(stockMovements);
  const [a] = await db.select({ n: count() }).from(auditLog).where(eq(auditLog.action, 'products.import'));
  return { products: p!.n, variants: v!.n, movements: m!.n, audits: a!.n };
}

const VALID = [
  HEADER,
  'Chino Slim,Northline,Tops,32,Sand,#c2b280,1090.00,600.50,4,6220000000017',
  'Chino Slim,northline,tops,34,Sand,,1090,,0,',
  'Oxford Shirt,Northline,Tops,M,White,#ffffff,850.5,400,2,',
].join('\n');

describe('POST /products/import?dryRun=1', () => {
  it('reports per-row errors (unknown brand/category, bad price, existing and duplicate variants) and writes nothing', async () => {
    const { db, brand, category, cookie } = await fixture();
    const existing = await createProductDirect(db, { name: 'Chino Slim', baseSku: 'NO-CHI', brandId: brand.id, categoryId: category.id, defaultPrice: 1000 });
    await createVariantDirect(db, { productId: existing.id, size: '30', colorName: 'Sand', sku: 'NO-CHI-30-SAND', sellPrice: 1000 });
    const before = await counts();
    const text = [
      HEADER,
      'Chino Slim,Northlne,Tops,32,Sand,,1090.00,,4,', // row 2: unknown brand
      'Canvas Low Sneaker,Northline,Tops,42,White,,abc,,6,', // row 3: bad price
      'Chino Slim,Northline,Tops,30,Sand,,1090.00,,1,', // row 4: already in DB
      'Chino Slim,Northline,Shoes,31,Sand,,1090.00,,1,', // row 5: unknown category
      'Oxford Shirt,Northline,Tops,M,White,,850,,1,', // row 6: ok
      'Oxford Shirt,Northline,Tops,M,White,,850,,1,', // row 7: duplicate in file
      'Oxford Shirt,Northline,Tops,L,White,#12345,850,,1,', // row 8: bad hex
      'Oxford Shirt,Northline,Tops,XL,White,,850,,-1,', // row 9: bad qty
    ].join('\n');
    const res = await upload(cookie, text);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toBe(8);
    expect(body.ok).toBe(1);
    const byRow = Object.fromEntries(body.errors.map((e: { row: number; message: string }) => [e.row, e.message]));
    expect(byRow).toEqual({
      2: 'Unknown brand',
      3: 'Price not a number',
      4: 'Variant already exists',
      5: 'Unknown category',
      7: 'Duplicate variant in file',
      8: 'Color hex must be #rrggbb',
      9: 'Qty must be a whole number ≥ 0',
    });
    expect(body.errors[0].data).toMatchObject({ name: 'Chino Slim', brand: 'Northlne', size: '32', color: 'Sand', price: '1090.00', qty: '4' });
    expect(await counts()).toEqual(before);
  });

  it('accepts a valid file (case-insensitive headers and names, BOM, CRLF) without writing', async () => {
    const { cookie } = await fixture();
    const text = '﻿' + VALID.replace(HEADER, HEADER.toUpperCase()).replace(/\n/g, '\r\n');
    const res = await upload(cookie, text);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: 3, ok: 3, errors: [] });
    expect(await counts()).toEqual({ products: 0, variants: 0, movements: 0, audits: 0 });
  });

  it('rejects a file missing required columns with 400', async () => {
    const { cookie } = await fixture();
    const res = await upload(cookie, 'name,brand,size\nChino,Northline,32\n');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.fields.file).toMatch(/category/);
  });

  it('rejects more than 5,000 data rows with 400', async () => {
    const { cookie } = await fixture();
    const lines = [HEADER];
    for (let i = 0; i < 5001; i++) lines.push(`P${i},Northline,Tops,M,Black,,10,,,`);
    const res = await upload(cookie, lines.join('\n'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.file).toMatch(/5,000/);
  });

  it('rejects a file over 2 MB with 400', async () => {
    const { cookie } = await fixture();
    const res = await upload(cookie, HEADER + '\n' + 'x'.repeat(2 * 1024 * 1024 + 10));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.file).toMatch(/2 MB/);
  });

  it('rejects binary (non-text) content with 400', async () => {
    const { cookie } = await fixture();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x14, 0x00]);
    const res = await upload(cookie, bytes);
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.file).toMatch(/text CSV/);
  });

  it('rejects a request without a file, a JSON body, or unknown query keys with 400', async () => {
    const { cookie } = await fixture();
    const noFile = await call(POST, { method: 'POST', path: '/api/v1/products/import?dryRun=1', cookie, form: new FormData() });
    expect(noFile.status).toBe(400);
    const asJson = await call(POST, { method: 'POST', path: '/api/v1/products/import?dryRun=1', cookie, body: { name: 'x.csv' } });
    expect(asJson.status).toBe(400);
    const unknown = await upload(cookie, VALID, '?dryRun=1&force=1');
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error.fields.force).toBe('Unknown field');
  });

  it('is forbidden for SELLER', async () => {
    const { cookie } = await fixture('SELLER');
    const res = await upload(cookie, VALID);
    expect(res.status).toBe(403);
  });
});

describe('POST /products/import (commit)', () => {
  it('is all-or-nothing: any row error → 400 with the report and nothing written', async () => {
    const { cookie } = await fixture();
    const text = VALID + '\nGhost Tee,Nobody,Tops,M,Black,,10,,1,';
    const res = await upload(cookie, text, '');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION');
    expect(body).toMatchObject({ rows: 4, ok: 3, errors: [{ row: 5, message: 'Unknown brand' }] });
    expect(await counts()).toEqual({ products: 0, variants: 0, movements: 0, audits: 0 });
  });

  it('creates products grouped by name+brand, prices in minor units, opening qty through the ledger, audited once', async () => {
    const { db, brand, category, cookie } = await fixture();
    // Existing product (same name + brand, different case) gets the new variants; its base SKU
    // also blocks the default "NO-OXF" for nothing, while "NO-CHI" is taken by another product.
    const existing = await createProductDirect(db, { name: 'chino slim', baseSku: 'CUSTOM-CHI', brandId: brand.id, categoryId: category.id, defaultPrice: 999, defaultCost: 300 });
    await createProductDirect(db, { name: 'Chino Straight', baseSku: 'NO-OXF', brandId: brand.id, categoryId: category.id, defaultPrice: 1 });

    const res = await upload(cookie, VALID, '');
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ rows: 3, ok: 3, errors: [], created: { products: 1, variants: 3 } });

    const vs = await db.select().from(variants);
    expect(vs).toHaveLength(3);
    const v32 = vs.find((v) => v.size === '32')!;
    expect(v32).toMatchObject({ productId: existing.id, sku: 'CUSTOM-CHI-32-SAND', sellPrice: 109000, costPrice: 60050, quantity: 4, colorHex: '#c2b280', barcode: '6220000000017' });
    const v34 = vs.find((v) => v.size === '34')!;
    // No hex → reuses the hex already used for that colour name; no cost → product default.
    expect(v34).toMatchObject({ productId: existing.id, quantity: 0, colorHex: '#c2b280', costPrice: 300, barcode: null });
    const shirt = vs.find((v) => v.size === 'M')!;
    expect(shirt).toMatchObject({ sellPrice: 85050, costPrice: 40000, quantity: 2 });

    const [newProduct] = await db.select().from(products).where(eq(products.id, shirt.productId));
    expect(newProduct).toMatchObject({ name: 'Oxford Shirt', brandId: brand.id, categoryId: category.id, defaultPrice: 85050, defaultCost: 40000 });
    expect(newProduct!.baseSku).not.toBe('NO-OXF');
    expect(shirt.sku).toBe(`${newProduct!.baseSku}-M-WHITE`);

    const movements = await db.select().from(stockMovements);
    expect(movements).toHaveLength(2);
    expect(movements.find((m) => m.variantId === v32.id)).toMatchObject({ type: 'INITIAL', qtyDelta: 4, qtyAfter: 4, unitCost: 60050 });

    // stock:verify invariant: every variant quantity equals the sum of its ledger.
    const drift = await db.execute(sql`
      select v.id from variants v
      left join stock_movements m on m.variant_id = v.id
      group by v.id, v.quantity
      having v.quantity <> coalesce(sum(m.qty_delta), 0)`);
    expect((drift as unknown as { rows: unknown[] }).rows).toHaveLength(0);

    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'products.import'));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ rows: 3, created: { products: 1, variants: 3 } });
  });

  it('rejects a barcode already used by another variant', async () => {
    const { db, brand, category, cookie } = await fixture();
    const p = await createProductDirect(db, { name: 'Other', baseSku: 'NO-OTH', brandId: brand.id, categoryId: category.id, defaultPrice: 1 });
    await createVariantDirect(db, { productId: p.id, size: 'S', colorName: 'Red', sku: 'NO-OTH-S-RED', sellPrice: 1, barcode: '6220000000017' });
    const res = await upload(cookie, VALID, '');
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([expect.objectContaining({ row: 2, message: 'Barcode already exists' })]);
  });
});
