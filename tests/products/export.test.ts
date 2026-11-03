import { sql } from 'drizzle-orm';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/products/export/route';
import { POST as IMPORT } from '@/app/api/v1/products/import/route';
import { getDb } from '@/db/client';
import { brands, categories } from '@/db/schema';
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

  it('writes the category path (any depth) and round-trips Men/Shirts vs Women/Shirts into a truncated catalogue', async () => {
    const db = getDb();
    const [brand] = await db.insert(brands).values({ name: 'Northline' }).returning();
    const [men] = await db.insert(categories).values({ name: 'Men' }).returning();
    const [women] = await db.insert(categories).values({ name: 'Women' }).returning();
    const [menShirts] = await db.insert(categories).values({ name: 'Shirts', parentId: men!.id }).returning();
    const [womenShirts] = await db.insert(categories).values({ name: 'Shirts', parentId: women!.id }).returning();
    const [formal] = await db.insert(categories).values({ name: 'Formal', parentId: menShirts!.id }).returning();
    const specs = [
      { name: 'Oxford', categoryId: menShirts!.id, sku: 'NO-OXF' },
      { name: 'Blouse', categoryId: womenShirts!.id, sku: 'NO-BLO' },
      { name: 'Dress Shirt', categoryId: formal!.id, sku: 'NO-DRS' },
    ];
    for (const s of specs) {
      const p = await createProductDirect(db, { name: s.name, baseSku: s.sku, brandId: brand!.id, categoryId: s.categoryId, defaultPrice: 100 });
      await createVariantDirect(db, { productId: p.id, size: 'M', colorName: 'White', sku: `${s.sku}-M-WHITE`, sellPrice: 100 });
    }
    const user = await createUser(db, { role: 'MANAGER' });
    const cookie = await sessionCookieFor(db, user.id);
    const csv = await (await exportCsv(cookie)).text();
    const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), { header: true, skipEmptyLines: true });
    expect(Object.fromEntries(parsed.data.map((r) => [r['name'], r['category']]))).toEqual({ Oxford: 'Men/Shirts', Blouse: 'Women/Shirts', 'Dress Shirt': 'Men/Shirts/Formal' });

    await db.execute(sql`truncate stock_movements, variants, products cascade`);
    const form = new FormData();
    form.append('file', new File([csv], 'products.csv', { type: 'text/csv' }));
    const res = await call(IMPORT, { method: 'POST', path: '/api/v1/products/import?dryRun=1', cookie, form });
    expect(await res.json()).toEqual({ rows: 3, ok: 3, errors: [] });
  });

  it('exports only ACTIVE products', async () => {
    const { db, cookie } = await fixture();
    const [brand] = await db.select().from(brands);
    const [category] = await db.select().from(categories);
    const old = await createProductDirect(db, { name: 'Old Tee', baseSku: 'NO-OLD', brandId: brand!.id, categoryId: category!.id, defaultPrice: 100, status: 'ARCHIVED' });
    await createVariantDirect(db, { productId: old.id, size: 'M', colorName: 'Black', sku: 'NO-OLD-M-BLACK', sellPrice: 100 });
    const text = await (await exportCsv(cookie)).text();
    expect(text).not.toContain('NO-OLD-M-BLACK');
  });

  it('round-trips a name neutralised after ";" — re-import matches the same product', async () => {
    const { db, cookie } = await fixture();
    const [brand] = await db.select().from(brands);
    const [category] = await db.select().from(categories);
    const tee = await createProductDirect(db, { name: 'Tee; -20%', baseSku: 'NO-TEE', brandId: brand!.id, categoryId: category!.id, defaultPrice: 100 });
    await createVariantDirect(db, { productId: tee.id, size: 'M', colorName: 'Black', sku: 'NO-TEE-M-BLACK', sellPrice: 100 });
    const csv = await (await exportCsv(cookie)).text();
    expect(csv).toContain(`"Tee; '-20%"`);
    const form = new FormData();
    form.append('file', new File([csv], 'products.csv', { type: 'text/csv' }));
    const body = await (await call(IMPORT, { method: 'POST', path: '/api/v1/products/import?dryRun=1', cookie, form })).json();
    const teeRow = body.errors.find((e: { data: { name: string } }) => e.data.name === 'Tee; -20%');
    expect(teeRow?.message).toBe('Variant already exists');
    expect(body.ok).toBe(0);
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
