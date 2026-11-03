import { describe, expect, it } from 'vitest';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { getDb } from '@/db/client';
import { sessions } from '@/db/schema';
import { call, readSetCookie } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

describe('GET /auth/me', () => {
  it('returns 401 without a session', async () => {
    const res = await call(me, { path: '/api/v1/auth/me' });
    expect(res.status).toBe(401);
  });

  it('returns the user, their permissions and public settings', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const res = await call(me, { path: '/api/v1/auth/me', cookie: await sessionCookieFor(db, u.id) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ id: u.id, email: u.email, role: 'SELLER' });
    expect(body.permissions).toContain('sales.create');
    expect(body.permissions).not.toContain('analytics.read');
    expect(body.settingsPublic).toMatchObject({ currency: 'EGP', timezone: 'Africa/Cairo', sellerDiscountCapPct: 10 });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    const cookie = await sessionCookieFor(db, u.id);
    const res = await call(logout, { method: 'POST', path: '/api/v1/auth/logout', cookie });
    expect(res.status).toBe(204);
    expect(readSetCookie(res, '__Host-as_session')).toContain('Max-Age=0');
    expect(await db.select().from(sessions)).toHaveLength(0);
    const after = await call(me, { path: '/api/v1/auth/me', cookie });
    expect(after.status).toBe(401);
  });

  it('requires a session', async () => {
    const res = await call(logout, { method: 'POST', path: '/api/v1/auth/logout' });
    expect(res.status).toBe(401);
  });
});
