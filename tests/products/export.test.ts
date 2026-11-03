import { sql } from 'drizzle-orm';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/products/export/route';
import { POST as IMPORT } from '@/app/api/v1/products/import/route';
import { getDb } from '@/db/client';
import { createProductDirect, createVariantDirect, seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

async function fixture(role: 'MANAGER' | 'SELLER' = 'MANAGER') {
  const db = getDb();
  const { brand, category } = await seedCatalog(db);
  const chino = await createProductDirect(db, { name: 'Chino Slim', baseSku: 'NO-CHI', brandId: brand.id, categoryId: category.id, defaultPrice: 109000 });
  await createVariantDirect(db, { productId: chino.id, size: '32', colorName: 'Sand', colorHex: '#c2b280', sku: 'NO-CHI-32-SAND', sellPrice: 109000, costPrice: 60050, quantity: 4, barcode: '6220000000017' });
  await createVariantDirect(db, { productId: chino.id, size: '34', colorName: 'Sand', colorHex: '#c2b280', sku: 'NO-CHI-34-SAND', sellPrice: 109005, quantity: 0 });
  await createVariantDirect(db, { productId: chino.id, size: '36', colorName: 'Sand', sku: 'NO-CHI-36-SAND', sellPrice: 1, isActive: false });
  const evil = await createProductDirect(db, { name: '=HYPERLINK("http://x")', baseSku: 'NO-EVL', brandId: brand.id, categoryId: category.id, defaultPrice: 100 });
  await createVariantDirect(db, { productId: evil.id, size: 'M', colorName: '+Red', sku: 'NO-EVL-M-RED', sellPrice: 100 });
  const user = await createUser(db, { role });
  const cookie = await sessionCookieFor(db, user.id);
  return { db, cookie };
}

function exportCsv(cookie: string, query = '') {
  return call(GET, { path: `/api/v1/products/export${query}`, cookie });
}

describe('GET /products/export', () => {
  it('returns a BOM-prefixed CSV with the import columns + sku, one row per active variant, prices in major units', async () => {
    const { cookie } = await fixture();
    const res = await exportCsv(cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="products\.csv"/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    expect(parsed.meta.fields).toEqual(['name', 'brand', 'category', 'size', 'color', 'colorHex', 'price', 'cost', 'qty', 'barcode', 'sku']);
    expect(parsed.data).toHaveLength(3);
    const s32 = parsed.data.find((r) => r['sku'] === 'NO-CHI-32-SAND');
    expect(s32).toEqual({ name: 'Chino Slim', brand: 'Northline', category: 'Tops', size: '32', color: 'Sand', colorHex: '#c2b280', price: '1090.00', cost: '600.50', qty: '4', barcode: '6220000000017', sku: 'NO-CHI-32-SAND' });
    expect(parsed.data.find((r) => r['sku'] === 'NO-CHI-34-SAND')).toMatchObject({ price: '1090.05', cost: '', qty: '0', barcode: '' });
    expect(parsed.data.find((r) => r['sku'] === 'NO-CHI-36-SAND')).toBeUndefined();
  });

  it('neutralises formula-leading cells', async () => {
    const { cookie } = await fixture();
    const text = await (await exportCsv(cookie)).text();
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).toContain(",'+Red,");
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('round-trips: the export dry-run imports cleanly into a catalogue without those products', async () => {
    const { db, cookie } = await fixture();
    const csv = await (await exportCsv(cookie)).text();
    const upload = () => {
      const form = new FormData();
      form.append('file', new File([csv], 'products.csv', { type: 'text/csv' }));
      return call(IMPORT, { method: 'POST', path: '/api/v1/products/import?dryRun=1', cookie, form });
    };

    // Same DB: every row is a variant that already exists.
    const same = await (await upload()).json();
    expect(same.rows).toBe(3);
    expect(same.errors.map((e: { message: string }) => e.message)).toEqual(['Variant already exists', 'Variant already exists', 'Variant already exists']);

    // Fresh catalogue shape (brands/categories kept, products gone): everything is importable.
    await db.execute(sql`truncate stock_movements, variants, products cascade`);
    const fresh = await upload();
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({ rows: 3, ok: 3, errors: [] });
  });

  it('rejects unknown query keys with 400 and SELLER with 403', async () => {
    const { cookie } = await fixture();
    expect((await exportCsv(cookie, '?all=1')).status).toBe(400);
    const db = getDb();
    const seller = await createUser(db, { role: 'SELLER' });
    const sellerCookie = await sessionCookieFor(db, seller.id);
    expect((await exportCsv(sellerCookie)).status).toBe(403);
  });
});
