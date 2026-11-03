import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import type { RouteHandler } from '@/lib/auth';
import { createSale } from '@/services/sales';
import { applyMovement } from '@/services/stock';
import { createProductDirect, createVariantDirect, seedCatalog } from '../helpers/catalog';
import { call } from '../helpers/http';
import { authUserOf } from '../helpers/sales';
import { createUser, sessionCookieFor } from '../helpers/users';

/**
 * Odd-input fuzz over every GET search parameter, as MANAGER (widest read scope that still
 * hits every route). Contract: 200 or 400, never 500; LIKE metacharacters match literally.
 */

const LITERAL = '100%_\\off'; // one product, one customer contain every wildcard payload verbatim

const WILDCARDS = ['%', '_', '\\', '%_\\'];
const PAYLOADS = [
  "'",
  "' or 1=1 --",
  ...WILDCARDS,
  ');drop table users;--',
  'قميص 👕 ‮abc‬',
  '\u0000',
  'a\u0000b',
  'x'.repeat(1000),
];

interface Target {
  name: string;
  load: () => Promise<{ GET?: RouteHandler }>;
  path: string;
  param: string;
  /** Extra query string (e.g. the export report name). */
  extra?: string;
  /** Exact-match lookup params: no row-content assertion, 404 is a valid answer. */
  exact?: boolean;
  csv?: boolean;
}

const TARGETS: Target[] = [
  { name: 'products q', load: () => import('@/app/api/v1/products/route'), path: '/products', param: 'q' },
  { name: 'products size', load: () => import('@/app/api/v1/products/route'), path: '/products', param: 'size', exact: true },
  { name: 'products color', load: () => import('@/app/api/v1/products/route'), path: '/products', param: 'color', exact: true },
  { name: 'variants search q', load: () => import('@/app/api/v1/variants/search/route'), path: '/variants/search', param: 'q' },
  { name: 'variants lookup sku', load: () => import('@/app/api/v1/variants/lookup/route'), path: '/variants/lookup', param: 'sku', exact: true },
  { name: 'variants lookup barcode', load: () => import('@/app/api/v1/variants/lookup/route'), path: '/variants/lookup', param: 'barcode', exact: true },
  { name: 'sales q', load: () => import('@/app/api/v1/sales/route'), path: '/sales', param: 'q' },
  { name: 'stock movements q', load: () => import('@/app/api/v1/stock/movements/route'), path: '/stock/movements', param: 'q' },
  { name: 'audit q', load: () => import('@/app/api/v1/audit/route'), path: '/audit', param: 'q' },
  { name: 'price-list q', load: () => import('@/app/api/v1/analytics/price-list/route'), path: '/analytics/price-list', param: 'q' },
  {
    name: 'export price-list q',
    load: () => import('@/app/api/v1/analytics/export/route'),
    path: '/analytics/export',
    param: 'q',
    extra: 'report=price-list',
    csv: true,
  },
];

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

function rowsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const b = body as { data?: unknown[]; items?: unknown[]; rows?: unknown[] };
  return b.data ?? b.items ?? b.rows ?? [];
}

let cookie = '';

beforeEach(async () => {
  const db = getDb();
  const manager = await createUser(db, { role: 'MANAGER', name: 'Mona' });
  cookie = await sessionCookieFor(db, manager.id);
  const { brand, category } = await seedCatalog(db);
  const base = { brandId: brand.id, categoryId: category.id };
  const chino = await createProductDirect(db, { ...base, name: 'Chino Slim', baseSku: 'NO-CHI', defaultPrice: 1000, defaultCost: 600 });
  const promo = await createProductDirect(db, { ...base, name: `Promo ${LITERAL} Tee`, baseSku: 'NO-PRO', defaultPrice: 500, defaultCost: 200 });
  const a = await createVariantDirect(db, { productId: chino.id, size: 'M', colorName: 'Navy', sku: 'NO-CHI-M-NAVY', sellPrice: 1000, costPrice: 600, barcode: '6221000000001' });
  const b = await createVariantDirect(db, { productId: promo.id, size: 'L', colorName: 'Black', sku: 'NO-PRO-L-BLACK', sellPrice: 500, costPrice: 200 });
  await db.transaction(async (tx) => {
    await applyMovement(tx, { variantId: a.id, type: 'INITIAL', qtyDelta: 5, unitCost: 600, reason: 'fuzz', userId: manager.id });
    await applyMovement(tx, { variantId: b.id, type: 'INITIAL', qtyDelta: 5, unitCost: 200, reason: 'fuzz', userId: manager.id });
  });
  const ctx = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'fuzz' };
  await createSale(db, authUserOf(manager, 'Mona'), { items: [{ variantId: a.id, qty: 1 }], paymentMethod: 'CASH', customerName: 'Plain Customer' }, ctx);
  await createSale(db, authUserOf(manager, 'Mona'), { items: [{ variantId: b.id, qty: 1 }], paymentMethod: 'CASH', customerName: `Cust ${LITERAL}` }, ctx);
});

describe('GET search params fuzz (MANAGER)', () => {
  for (const t of TARGETS) {
    it(`${t.name}: odd input → 200/400 (404 for exact lookups), never 500; wildcards match literally`, async () => {
      const mod = await t.load();
      const handler = mod.GET!;
      const failures: string[] = [];
      for (const payload of PAYLOADS) {
        const qs = [t.extra, `${t.param}=${encodeURIComponent(payload)}`].filter(Boolean).join('&');
        const res = await call(handler, { path: `/api/v1${t.path}?${qs}`, cookie });
        const ok = res.status === 200 || res.status === 400 || (t.exact && res.status === 404);
        const label = JSON.stringify(payload.length > 20 ? `${payload.slice(0, 20)}…(${payload.length})` : payload);
        if (!ok) {
          failures.push(`${label} → ${res.status} ${await res.text()}`);
          continue;
        }
        if (res.status !== 200 || t.exact) continue;
        if (!WILDCARDS.includes(payload)) continue;
        if (t.csv) {
          const lines = (await res.text()).replace(/^﻿/, '').trim().split(/\r?\n/).slice(1);
          for (const line of lines) if (!line.includes(payload)) failures.push(`${label} returned non-matching CSV row ${line}`);
          continue;
        }
        const rows = rowsOf(await res.json());
        for (const row of rows) {
          if (!strings(row).some((s) => s.toLowerCase().includes(payload.toLowerCase()))) {
            failures.push(`${label} returned a row without the literal text: ${JSON.stringify(row).slice(0, 200)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it('wildcard search still finds the row that literally contains it', async () => {
    const { GET } = await import('@/app/api/v1/products/route');
    const res = await call(GET, { path: `/api/v1/products?q=${encodeURIComponent('%_\\')}`, cookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((p: { name: string }) => p.name)).toEqual([`Promo ${LITERAL} Tee`]);
  });

  it('a NUL inside a JSON body is a 400, not a Postgres 22021 → 500', async () => {
    const { POST } = await import('@/app/api/v1/brands/route');
    const res = await call(POST, { method: 'POST', path: '/api/v1/brands', cookie, body: { name: 'Bad\u0000Brand' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION');
  });

  it('the users table survives the injection attempts', async () => {
    const { GET } = await import('@/app/api/v1/sales/route');
    await call(GET, { path: `/api/v1/sales?q=${encodeURIComponent(');drop table users;--')}`, cookie });
    const res = await call(GET, { path: '/api/v1/sales', cookie });
    expect(res.status).toBe(200);
    expect((await res.json()).total).toBe(2);
  });
});
