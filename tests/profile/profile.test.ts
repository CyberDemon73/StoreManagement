import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as meGET } from '@/app/api/v1/auth/me/route';
import { PATCH as mePATCH } from '@/app/api/v1/me/route';
import { POST as passwordPOST } from '@/app/api/v1/me/password/route';
import { GET as lowGET } from '@/app/api/v1/stock/low/route';
import { getDb } from '@/db/client';
import { auditLog, users } from '@/db/schema';
import { SESSION_COOKIE } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import { call, cookiePair, readSetCookie } from '../helpers/http';
import { createUser, DEFAULT_PASSWORD, sessionCookieFor } from '../helpers/users';

const NEXT = 'Yq8!vt-plume-orbit2';

function changePassword(cookie: string, body: unknown) {
  return call(passwordPOST, { method: 'POST', path: '/api/v1/me/password', cookie, body });
}

describe('PATCH /me', () => {
  it('renames the current user and audits it', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER', name: 'Old' });
    const res = await call(mePATCH, { method: 'PATCH', path: '/api/v1/me', cookie: await sessionCookieFor(db, u.id), body: { name: '  New Name ' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ id: u.id, name: 'New Name', roles: ['SELLER'] });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    const [row] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'user.update'), eq(auditLog.entityId, u.id)));
    expect(row).toMatchObject({ userId: u.id, entity: 'user', before: { name: 'Old' }, after: { name: 'New Name' } });
  });

  it('rejects an empty name and unknown keys', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const cookie = await sessionCookieFor(db, u.id);
    expect((await call(mePATCH, { method: 'PATCH', path: '/api/v1/me', cookie, body: { name: ' ' } })).status).toBe(400);
    expect((await call(mePATCH, { method: 'PATCH', path: '/api/v1/me', cookie, body: { name: 'X', role: 'ADMIN' } })).status).toBe(400);
  });

  it('requires a session', async () => {
    expect((await call(mePATCH, { method: 'PATCH', path: '/api/v1/me', body: { name: 'X' } })).status).toBe(401);
  });
});

describe('POST /me/password', () => {
  it('rejects a wrong current password', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const res = await changePassword(await sessionCookieFor(db, u.id), { current: 'Wrong-password-123', next: NEXT });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toMatchObject({ current: 'Incorrect password' });
  });

  it('rejects a common or reused next password', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const cookie = await sessionCookieFor(db, u.id);
    const common = await changePassword(cookie, { current: DEFAULT_PASSWORD, next: 'password123' });
    expect(common.status).toBe(400);
    expect((await common.json()).error.fields).toHaveProperty('next');
    const same = await changePassword(cookie, { current: DEFAULT_PASSWORD, next: DEFAULT_PASSWORD });
    expect(same.status).toBe(400);
    expect((await same.json()).error.fields).toHaveProperty('next');
  });

  it('changes the password, revokes every old session, and issues a working new cookie', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, u.id));
    const oldCookie = await sessionCookieFor(db, u.id);
    const otherDevice = await sessionCookieFor(db, u.id);

    // Forced change blocks business routes first.
    expect((await call(lowGET, { path: '/api/v1/stock/low', cookie: oldCookie })).status).toBe(403);

    const res = await changePassword(oldCookie, { current: DEFAULT_PASSWORD, next: NEXT });
    expect(res.status).toBe(204);
    const setCookie = readSetCookie(res, SESSION_COOKIE);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).not.toContain('Max-Age');
    const newCookie = cookiePair(res, SESSION_COOKIE)!;
    expect(newCookie).not.toBe(oldCookie);

    expect((await call(meGET, { path: '/api/v1/auth/me', cookie: oldCookie })).status).toBe(401);
    expect((await call(meGET, { path: '/api/v1/auth/me', cookie: otherDevice })).status).toBe(401);
    const me = await call(meGET, { path: '/api/v1/auth/me', cookie: newCookie });
    expect(me.status).toBe(200);
    expect((await me.json()).user.mustChangePassword).toBe(false);
    expect((await call(lowGET, { path: '/api/v1/stock/low', cookie: newCookie })).status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(await verifyPassword(row!.passwordHash, NEXT)).toBe(true);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'user.password_change'));
    expect(entry).toMatchObject({ userId: u.id, entity: 'user', entityId: u.id });
    expect(JSON.stringify(entry)).not.toContain(NEXT);
  });

  it('rejects unknown keys and requires a session', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const res = await changePassword(await sessionCookieFor(db, u.id), { current: DEFAULT_PASSWORD, next: NEXT, extra: 1 });
    expect(res.status).toBe(400);
    expect((await call(passwordPOST, { method: 'POST', path: '/api/v1/me/password', body: { current: 'a', next: NEXT } })).status).toBe(401);
  });
});
