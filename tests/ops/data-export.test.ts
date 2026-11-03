import { eq, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { GET as EXPORT, maxDuration } from '@/app/api/v1/data/export/route';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { auditLog, brands, idempotencyKeys, knownDevices, users } from '@/db/schema';
import { buildDataExport, EXCLUDED_TABLES, EXPORTED_TABLES, keysetPages, streamDataExport } from '@/services/data-export';
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

describe('streamed export (Vercel 4.5 MB non-streamed cap)', () => {
  it('route allows a 60 s budget and returns a streamed body', async () => {
    expect(maxDuration).toBe(60);
    const db = getDb();
    const admin = await createUser(db, { role: 'ADMIN' });
    const res = await download(await sessionCookieFor(db, admin.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.body).toBeInstanceOf(ReadableStream);
    await res.arrayBuffer();
  });

  it('pages through tables larger than one page: 2,500 audit rows all present, once each', async () => {
    const db = getDb();
    const admin = await createUser(db, { role: 'ADMIN' });
    const rows = Array.from({ length: 2500 }, (_, i) => ({ userId: admin.id, action: `bulk.${i}`, entity: 'test' }));
    for (let i = 0; i < rows.length; i += 500) await db.insert(auditLog).values(rows.slice(i, i + 500));
    const expected = (await db.select({ id: auditLog.id }).from(auditLog)).map((r) => r.id).sort();
    expect(expected.length).toBeGreaterThanOrEqual(2500);

    const { zip, tables } = await buildDataExport(db);
    expect(tables.audit_log).toBe(expected.length);
    const raw = unzipSync(zip);
    expect([...raw['audit_log.csv']!.slice(0, 3)]).toEqual(BOM);
    const lines = strFromU8(raw['audit_log.csv']!).split('\r\n').filter(Boolean);
    const header = lines[0]!.split(',');
    expect(lines.filter((l) => l.startsWith('id,'))).toHaveLength(1); // header once per file
    const idCol = header.indexOf('id');
    const got = lines.slice(1).map((l) => l.split(',')[idCol]!).sort();
    expect(got).toEqual(expected);
    // Still no secrets / excluded tables.
    expect(raw['sessions.csv']).toBeUndefined();
    expect(strFromU8(raw['users.csv']!)).not.toContain('password_hash');
  });

  it('the stream emits chunks progressively (more than one) rather than one buffered blob', async () => {
    const db = getDb();
    await createUser(db, { role: 'ADMIN' });
    const reader = streamDataExport(db).getReader();
    let chunks = 0;
    let firstChunkBeforeDone = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (chunks === 0 && value.byteLength > 0) firstChunkBeforeDone = true;
      chunks++;
    }
    expect(firstChunkBeforeDone).toBe(true);
    expect(chunks).toBeGreaterThan(1);
  });

  it('an aborted download is still audited, marked completed: false', async () => {
    const db = getDb();
    const admin = await createUser(db, { role: 'ADMIN' });
    const res = await download(await sessionCookieFor(db, admin.id));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'data.export'));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.after as { completed: boolean }).completed).toBe(false);
  });

  it('keysetPages walks a composite primary key without gaps or repeats', async () => {
    const db = getDb();
    const a = await createUser(db, { role: 'ADMIN' });
    const b = await createUser(db, { role: 'SELLER' });
    for (const u of [a, b]) for (let i = 0; i < 3; i++) await db.insert(knownDevices).values({ userId: u.id, deviceHash: `d${i}` });
    const seen: string[] = [];
    let pages = 0;
    for await (const page of keysetPages(db, knownDevices, 2)) {
      pages++;
      for (const r of page) seen.push(`${r.userId}/${r.deviceHash}`);
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
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
