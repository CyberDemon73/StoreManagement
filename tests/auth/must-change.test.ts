import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as mePassword } from '@/app/api/v1/me/password/route';
import { GET as low } from '@/app/api/v1/stock/low/route';
import { getDb } from '@/db/client';
import { users } from '@/db/schema';
import { SESSION_COOKIE } from '@/lib/auth';
import { call, cookiePair } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

describe('forced password change', () => {
  it('blocks business routes until the password is changed, but allows me and logout', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, u.id));
    const cookie = await sessionCookieFor(db, u.id);
    const blocked = await call(low, { path: '/api/v1/stock/low', cookie });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.fields.password).toBe('Password change required');
    const mine = await call(me, { path: '/api/v1/auth/me', cookie });
    expect(mine.status).toBe(200);
    expect((await mine.json()).user.mustChangePassword).toBe(true);
    expect((await call(logout, { method: 'POST', path: '/api/v1/auth/logout', cookie })).status).toBe(204);
  });
});

describe('forced password change → POST /me/password (Review Focus 3)', () => {
  it('old cookie dies, the new cookie reaches business routes, every other session dies', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, u.id));
    const oldCookie = await sessionCookieFor(db, u.id);
    const secondSession = await sessionCookieFor(db, u.id);
    expect((await call(low, { path: '/api/v1/stock/low', cookie: oldCookie })).status).toBe(403);

    const res = await call(mePassword, { method: 'POST', path: '/api/v1/me/password', cookie: oldCookie, body: { current: u.password, next: 'Yq8!vt-plume-orbit2' } });
    expect(res.status).toBe(204);
    const newCookie = cookiePair(res, SESSION_COOKIE);
    expect(newCookie).toBeTruthy();

    expect((await call(me, { path: '/api/v1/auth/me', cookie: oldCookie })).status).toBe(401);
    expect((await call(low, { path: '/api/v1/stock/low', cookie: newCookie })).status).toBe(200);
    expect((await call(me, { path: '/api/v1/auth/me', cookie: secondSession })).status).toBe(401);
    expect((await call(low, { path: '/api/v1/stock/low', cookie: secondSession })).status).toBe(401);
  });
});
