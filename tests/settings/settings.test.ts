import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as meGET } from '@/app/api/v1/auth/me/route';
import { GET, PATCH } from '@/app/api/v1/settings/route';
import { getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { nextNumber } from '@/services/stock';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

async function managerCookie() {
  const db = getDb();
  const m = await createUser(db, { role: 'MANAGER' });
  return { db, m, cookie: await sessionCookieFor(db, m.id) };
}

async function patch(cookie: string, body: unknown) {
  return call(PATCH, { method: 'PATCH', path: '/api/v1/settings', cookie, body });
}

describe('GET /settings', () => {
  it('gives a MANAGER the full settings with nextSaleNumber', async () => {
    const { db, cookie } = await managerCookie();
    await db.transaction((tx) => nextNumber(tx, 'AS'));
    await db.transaction((tx) => nextNumber(tx, 'AS'));
    const res = await call(GET, { path: '/api/v1/settings', cookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      storeName: 'Avenue Brand',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      dateFormat: 'DD/MM/YYYY',
      saleNumberPrefix: 'AS',
      nextSaleNumber: 3,
      sellerDiscountCapPct: 10,
      allowNegativeStock: false,
      requirePhoneOnTransfer: false,
      receiptShowLogo: true,
      sessionIdleHours: 12,
      largeRefundAlert: 100000,
      sizePresets: [],
      colorPresets: [],
    });
    expect(body).not.toHaveProperty('lockoutEnabled');
    expect(body).not.toHaveProperty('passwordRotationDays');
  });

  it('defaults nextSaleNumber to 1 when no sale was numbered yet', async () => {
    const { cookie } = await managerCookie();
    const body = await (await call(GET, { path: '/api/v1/settings', cookie })).json();
    expect(body.nextSaleNumber).toBe(1);
  });

  it('gives a SELLER only the public subset', async () => {
    const db = getDb();
    const s = await createUser(db, { role: 'SELLER' });
    const res = await call(GET, { path: '/api/v1/settings', cookie: await sessionCookieFor(db, s.id) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ storeName: 'Avenue Brand', currency: 'EGP', sellerDiscountCapPct: 10 });
    expect(body).not.toHaveProperty('largeRefundAlert');
    expect(body).not.toHaveProperty('nextSaleNumber');
    expect(body).not.toHaveProperty('sessionIdleHours');
  });

  it('requires a session', async () => {
    expect((await call(GET, { path: '/api/v1/settings' })).status).toBe(401);
  });
});

describe('PATCH /settings', () => {
  it('applies a valid change, audits only the changed keys, and shows it on /auth/me', async () => {
    const { db, m, cookie } = await managerCookie();
    const res = await patch(cookie, {
      storeName: 'Avenue Downtown',
      timezone: 'Europe/London',
      sellerDiscountCapPct: 12.5,
      currency: 'EGP',
      sizePresets: [{ name: 'Shoes', sizes: ['40', '41'] }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      storeName: 'Avenue Downtown',
      timezone: 'Europe/London',
      sellerDiscountCapPct: 12.5,
      sizePresets: [{ name: 'Shoes', sizes: ['40', '41'] }],
      nextSaleNumber: 1,
    });

    const rows = await db.select().from(auditLog).where(and(eq(auditLog.action, 'settings.update'), eq(auditLog.userId, m.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entity).toBe('settings');
    expect(rows[0]!.entityId).toBeNull();
    expect(rows[0]!.before).toEqual({ storeName: 'Avenue Brand', timezone: 'Africa/Cairo', sellerDiscountCapPct: 10, sizePresets: [] });
    expect(rows[0]!.after).toEqual({
      storeName: 'Avenue Downtown',
      timezone: 'Europe/London',
      sellerDiscountCapPct: 12.5,
      sizePresets: [{ name: 'Shoes', sizes: ['40', '41'] }],
    });

    const me = await (await call(meGET, { path: '/api/v1/auth/me', cookie })).json();
    expect(me.settingsPublic).toMatchObject({ storeName: 'Avenue Downtown', timezone: 'Europe/London', sellerDiscountCapPct: 12.5 });
  });

  it('accepts the full validated field set', async () => {
    const { cookie } = await managerCookie();
    const res = await patch(cookie, {
      logoUrl: 'https://cdn.example.com/logo.png',
      phone: '+20 100 000 0000',
      address: '1 Nile St',
      currency: 'USD',
      dateFormat: 'YYYY-MM-DD',
      lowStockDefault: 0,
      saleNumberPrefix: 'AVE',
      allowNegativeStock: true,
      requirePhoneOnTransfer: true,
      receiptHeader: 'Hello',
      receiptFooter: 'Bye',
      receiptShowLogo: false,
      sessionIdleHours: 72,
      sessionAbsoluteDays: 30,
      largeRefundAlert: 1,
      colorPresets: [{ name: 'Black', hex: '#000000' }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ saleNumberPrefix: 'AVE', dateFormat: 'YYYY-MM-DD', receiptShowLogo: false, largeRefundAlert: 1 });
  });

  it.each([
    ['unknown timezone', { timezone: 'Mars/Olympus' }, 'timezone'],
    ['lowercase prefix', { saleNumberPrefix: 'as-' }, 'saleNumberPrefix'],
    ['reserved prefix PO', { saleNumberPrefix: 'PO' }, 'saleNumberPrefix'],
    ['reserved prefix SC', { saleNumberPrefix: 'SC' }, 'saleNumberPrefix'],
    ['cap above 100', { sellerDiscountCapPct: 101 }, 'sellerDiscountCapPct'],
    ['cap with 3 decimals', { sellerDiscountCapPct: 10.125 }, 'sellerDiscountCapPct'],
    ['unknown key lockoutEnabled', { lockoutEnabled: true }, null],
    ['read-only nextSaleNumber', { nextSaleNumber: 5 }, null],
    ['lowercase currency', { currency: 'egp' }, 'currency'],
    ['http logo', { logoUrl: 'http://example.com/x.png' }, 'logoUrl'],
    ['idle hours 0', { sessionIdleHours: 0 }, 'sessionIdleHours'],
    ['absolute days 31', { sessionAbsoluteDays: 31 }, 'sessionAbsoluteDays'],
    ['refund alert 0', { largeRefundAlert: 0 }, 'largeRefundAlert'],
    ['idle hours above absolute window', { sessionIdleHours: 25, sessionAbsoluteDays: 1 }, 'sessionIdleHours'],
    ['low stock 1001', { lowStockDefault: 1001 }, 'lowStockDefault'],
    ['bad date format', { dateFormat: 'MM/DD/YYYY' }, 'dateFormat'],
    ['bad colour', { colorPresets: [{ name: 'X', hex: 'red' }] }, null],
    ['empty size list', { sizePresets: [{ name: 'X', sizes: [] }] }, null],
    ['long footer', { receiptFooter: 'x'.repeat(501) }, 'receiptFooter'],
    ['float refund alert', { largeRefundAlert: 10.5 }, 'largeRefundAlert'],
  ])('rejects %s with 400', async (_label, body, field) => {
    const { cookie } = await managerCookie();
    const res = await patch(cookie, body);
    expect(res.status).toBe(400);
    const err = (await res.json()).error;
    expect(err.code).toBe('VALIDATION');
    if (field) expect(err.fields).toHaveProperty(field);
  });

  it('rejects idle hours that exceed the stored absolute window', async () => {
    const { cookie } = await managerCookie();
    expect((await patch(cookie, { sessionIdleHours: 12, sessionAbsoluteDays: 1 })).status).toBe(200);
    const res = await patch(cookie, { sessionIdleHours: 30 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toHaveProperty('sessionIdleHours');
  });

  it('rejects an absolute window shorter than the stored idle hours', async () => {
    const { cookie } = await managerCookie();
    expect((await patch(cookie, { sessionIdleHours: 30 })).status).toBe(200);
    const res = await patch(cookie, { sessionAbsoluteDays: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toHaveProperty('sessionIdleHours');
  });

  it('stores blank text fields as cleared', async () => {
    const { cookie } = await managerCookie();
    await patch(cookie, { receiptHeader: 'Hi', phone: '123', address: 'A', receiptFooter: 'F', logoUrl: 'https://x.example/l.png' });
    const res = await patch(cookie, { receiptHeader: '   ', phone: '', address: ' ', receiptFooter: '', logoUrl: '  ' });
    expect(res.status).toBe(200);
    const body = await (await call(GET, { path: '/api/v1/settings', cookie })).json();
    for (const k of ['receiptHeader', 'phone', 'address', 'receiptFooter', 'logoUrl']) expect(body).not.toHaveProperty(k);
  });

  it('rejects an empty body', async () => {
    const { cookie } = await managerCookie();
    expect((await patch(cookie, {})).status).toBe(400);
  });

  it('leaves settings unchanged after a rejected timezone', async () => {
    const { cookie } = await managerCookie();
    await patch(cookie, { timezone: 'Mars/Olympus', storeName: 'Nope' });
    const body = await (await call(GET, { path: '/api/v1/settings', cookie })).json();
    expect(body).toMatchObject({ timezone: 'Africa/Cairo', storeName: 'Avenue Brand' });
  });

  it('forbids a SELLER', async () => {
    const db = getDb();
    const s = await createUser(db, { role: 'SELLER' });
    const res = await patch(await sessionCookieFor(db, s.id), { storeName: 'X' });
    expect(res.status).toBe(403);
  });
});
