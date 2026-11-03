import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DELETE, PATCH } from '@/app/api/v1/variants/[id]/route';
import { getDb } from '@/db/client';
import { auditLog, variants } from '@/db/schema';
import { applyMovement } from '@/services/stock';
import { createProductDirect, createVariantDirect, seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000009';

async function fixture() {
  const db = getDb();
  const { brand, category } = await seedCatalog(db);
  const product = await createProductDirect(db, { name: 'Chino Slim', baseSku: 'NO-CHI', brandId: brand.id, categoryId: category.id, defaultPrice: 1000 });
  const a = await createVariantDirect(db, { productId: product.id, size: 'S', colorName: 'Black', sku: 'NO-CHI-S-BLACK', sellPrice: 1000, barcode: '6221000000001' });
  const b = await createVariantDirect(db, { productId: product.id, size: 'M', colorName: 'Black', sku: 'NO-CHI-M-BLACK', sellPrice: 1000 });
  const manager = await createUser(db, { role: 'MANAGER' });
  const cookie = await sessionCookieFor(db, manager.id);
  const seller = await createUser(db, { role: 'SELLER' });
  const sellerCookie = await sessionCookieFor(db, seller.id);
  return { db, product, a, b, cookie, sellerCookie };
}

describe('PATCH /variants/:id', () => {
  it('updates price fields and audits before/after', async () => {
    const { db, b, cookie } = await fixture();
    const res = await call(PATCH, { method: 'PATCH', path: `/api/v1/variants/${b.id}`, cookie, params: { id: b.id }, body: { sellPrice: 1500, costPrice: 700, lowStockThreshold: 5 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: b.id, sellPrice: 1500, costPrice: 700, lowStockThreshold: 5, color: { name: 'Black', hex: '#000000' } });
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'variant.update'));
    expect(row).toBeDefined();
    expect((row!.before as { sellPrice: number }).sellPrice).toBe(1000);
    expect((row!.after as { sellPrice: number }).sellPrice).toBe(1500);
  });

  it('rejects quantity (ledger only), malformed ids and unknown variants', async () => {
    const { b, cookie } = await fixture();
    const qty = await call(PATCH, { method: 'PATCH', path: `/api/v1/variants/${b.id}`, cookie, params: { id: b.id }, body: { quantity: 9 } });
    expect(qty.status).toBe(400);
    expect((await qty.json()).error.fields.quantity).toBeDefined();
    expect((await call(PATCH, { method: 'PATCH', path: '/api/v1/variants/abc', cookie, params: { id: 'abc' }, body: { sellPrice: 1 } })).status).toBe(400);
    expect((await call(PATCH, { method: 'PATCH', path: `/api/v1/variants/${UNKNOWN_ID}`, cookie, params: { id: UNKNOWN_ID }, body: { sellPrice: 1 } })).status).toBe(404);
  });

  it('returns 409 fields.barcode / fields.sku on duplicates and clears a barcode with null', async () => {
    const { a, b, cookie } = await fixture();
    const dupBarcode = await call(PATCH, { method: 'PATCH', path: `/api/v1/variants/${b.id}`, cookie, params: { id: b.id }, body: { barcode: '6221000000001' } });
    expect(dupBarcode.status).toBe(409);
    expect((await dupBarcode.json()).error.fields.barcode).toBeDefined();
    const dupSku = await call(PATCH, { method: 'PATCH', path: `/api/v1/variants/${b.id}`, cookie, params: { id: b.id }, body: { sku: 'no-chi-s-black' } });
    expect(dupSku.status).toBe(409);
    expect((await dupSku.json()).error.fields.sku).toBeDefined();
    const cleared = await call(PATCH, { method: 'PATCH', path: `/api/v1/variants/${a.id}`, cookie, params: { id: a.id }, body: { barcode: null } });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).barcode).toBeUndefined();
  });

  it('returns 403 for a SELLER', async () => {
    const { b, sellerCookie } = await fixture();
    const res = await call(PATCH, { method: 'PATCH', path: `/api/v1/variants/${b.id}`, cookie: sellerCookie, params: { id: b.id }, body: { sellPrice: 1 } });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /variants/:id', () => {
  it('hard-deletes an untouched variant (204) and audits', async () => {
    const { db, b, cookie } = await fixture();
    const res = await call(DELETE, { method: 'DELETE', path: `/api/v1/variants/${b.id}`, cookie, params: { id: b.id } });
    expect(res.status).toBe(204);
    expect(await db.select().from(variants).where(eq(variants.id, b.id))).toEqual([]);
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'variant.delete'));
    expect(row?.entityId).toBe(b.id);
    expect((await call(DELETE, { method: 'DELETE', path: `/api/v1/variants/${b.id}`, cookie, params: { id: b.id } })).status).toBe(404);
  });

  it('refuses (409) once the variant has a ledger entry, even when back at zero', async () => {
    const { db, b, cookie } = await fixture();
    await db.transaction((tx) => applyMovement(tx, { variantId: b.id, type: 'INITIAL', qtyDelta: 2, unitCost: 500, userId: null }));
    const stocked = await call(DELETE, { method: 'DELETE', path: `/api/v1/variants/${b.id}`, cookie, params: { id: b.id } });
    expect(stocked.status).toBe(409);
    expect((await stocked.json()).error.code).toBe('CONFLICT');
    await db.transaction((tx) => applyMovement(tx, { variantId: b.id, type: 'ADJUSTMENT', qtyDelta: -2, userId: null }));
    expect((await call(DELETE, { method: 'DELETE', path: `/api/v1/variants/${b.id}`, cookie, params: { id: b.id } })).status).toBe(409);
    expect(await db.select().from(variants).where(eq(variants.id, b.id))).toHaveLength(1);
  });

  it('returns 403 for a SELLER', async () => {
    const { b, sellerCookie } = await fixture();
    expect((await call(DELETE, { method: 'DELETE', path: `/api/v1/variants/${b.id}`, cookie: sellerCookie, params: { id: b.id } })).status).toBe(403);
  });
});
