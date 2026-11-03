import { eq, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { GET as EXPORT } from '@/app/api/v1/data/export/route';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { auditLog, brands, idempotencyKeys, knownDevices, users } from '@/db/schema';
import { buildDataExport, EXCLUDED_TABLES, EXPORTED_TABLES } from '@/services/data-export';
import { call } from '../helpers/http';
import { stockFixture } from '../helpers/stock';
import { createUser, sessionCookieFor } from '../helpers/users';

const SECRET_TABLES = ['sessions', 'password_reset_tokens', 'idempotency_keys', 'failed_logins', 'known_devices'];

async function download(cookie: string | null) {
  return call(EXPORT, { path: '/api/v1/data/export', cookie });
}

// strFromU8 (TextDecoder) drops a leading BOM, so BOM presence is checked on the raw bytes.
const text = (raw: Record<string, Uint8Array>) => Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, strFromU8(v)]));
const BOM = [0xef, 0xbb, 0xbf];

describe('data export coverage', () => {
  it('every schema table is either exported or explicitly excluded, never both', () => {
    const all = Object.values(schema)
      .filter((v) => is(v, PgTable))
      .map((t) => getTableName(t as PgTable))
      .sort();
    const exported = [...EXPORTED_TABLES].sort();
    const excluded = [...EXCLUDED_TABLES].sort();
    expect([...exported, ...excluded].sort()).toEqual(all);
    expect(excluded).toEqual([...SECRET_TABLES].sort());
  });
});

describe('GET /data/export', () => {
  it('ADMIN gets a zip with one CSV per business table, no secrets, and the action is audited', async () => {
    const db = getDb();
    const admin = await createUser(db, { role: 'ADMIN' });
    await stockFixture(db, admin.id);
    await db.insert(brands).values({ name: '=HYPERLINK("http://evil")' });
    await db.insert(knownDevices).values({ userId: admin.id, deviceHash: 'device-hash-secret' });
    await db.insert(idempotencyKeys).values({ userId: admin.id, route: 'x', key: 'k', requestHash: 'h', status: 200, response: {} });
    const cookie = await sessionCookieFor(db, admin.id);

    const res = await download(cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="avenue-stock-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const raw = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const files = text(raw);
    expect(Object.keys(files).sort()).toEqual(EXPORTED_TABLES.map((t) => `${t}.csv`).sort());
    for (const t of SECRET_TABLES) expect(files[`${t}.csv`]).toBeUndefined();

    const usersCsv = files['users.csv']!;
    expect([...raw['users.csv']!.slice(0, 3)]).toEqual(BOM);
    expect([...raw['returns.csv']!.slice(0, 3)]).toEqual(BOM);
    const header = usersCsv.split('\r\n')[0]!;
    expect(header.split(',')).toContain('email');
    expect(header).not.toContain('password_hash');
    expect(usersCsv).not.toContain('$argon2');
    expect(usersCsv).toContain(admin.email);

    // Empty tables still carry a header row.
    expect(files['returns.csv']!.split('\r\n')[0]).toContain('sale_id');
    // Variants and movements are real rows; dates are ISO strings.
    expect(files['variants.csv']).toContain('NO-CHI-S-BLACK');
    expect(files['stock_movements.csv']).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    // Formula neutralisation from toCsv.
    expect(files['brands.csv']).toContain(`"'=HYPERLINK(""http://evil"")"`);
    for (const content of Object.values(files)) expect(content).not.toContain('device-hash-secret');

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'data.export'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: admin.id, entity: 'data' });
    expect((rows[0]!.after as { tables: Record<string, number> }).tables.variants).toBe(3);
  });

  it('MANAGER and SELLER get 403, anonymous 401', async () => {
    const db = getDb();
    const manager = await createUser(db, { role: 'MANAGER' });
    const seller = await createUser(db, { role: 'SELLER' });
    const m = await download(await sessionCookieFor(db, manager.id));
    expect(m.status).toBe(403);
    expect((await m.json()).error.code).toBe('FORBIDDEN');
    expect((await download(await sessionCookieFor(db, seller.id))).status).toBe(403);
    expect((await download(null)).status).toBe(401);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'data.export'))).toHaveLength(0);
  });
});

describe('buildDataExport', () => {
  it('reports row counts per table', async () => {
    const db = getDb();
    await createUser(db, { role: 'ADMIN' });
    const { tables, zip } = await buildDataExport(db);
    expect(tables.users).toBe(1);
    expect(tables.sales).toBe(0);
    expect(zip).toBeInstanceOf(Uint8Array);
    const [u] = await db.select({ id: users.id }).from(users);
    expect(strFromU8(unzipSync(zip)['users.csv']!)).toContain(u!.id);
  });
});
