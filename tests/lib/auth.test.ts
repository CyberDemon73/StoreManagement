import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { sessions, users } from '@/db/schema';
import {
  clearSessionCookieHeader,
  createSession,
  getSessionUser,
  hashToken,
  revokeAllSessions,
  SESSION_COOKIE,
  sessionCookieHeader,
  withAuth,
} from '@/lib/auth';
import { json } from '@/lib/http';
import { stripCostFields } from '@/serializers/seller';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

function reqWithCookie(cookie: string | null): Request {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new Request('http://localhost:3000/api/v1/x', { headers });
}

describe('sessions', () => {
  it('stores only the SHA-256 of the raw token', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    const s = await createSession(db, { userId: u.id, ip: null, userAgent: null, remember: false });
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(hashToken(s.raw));
    expect(rows[0]?.id).not.toBe(s.raw);
    expect(s.raw.length).toBeGreaterThanOrEqual(43);
  });

  it('resolves a user from a valid cookie and ignores bad ones', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const cookie = await sessionCookieFor(db, u.id);
    const user = await getSessionUser(db, reqWithCookie(cookie));
    expect(user?.id).toBe(u.id);
    expect(user?.role).toBe('SELLER');
    expect(user?.sessionId).toBe(hashToken(cookie.split('=')[1] ?? ''));
    expect(await getSessionUser(db, reqWithCookie(null))).toBeNull();
    expect(await getSessionUser(db, reqWithCookie(`${SESSION_COOKIE}=not-a-real-token`))).toBeNull();
  });

  it('rejects sessions past absolute or idle expiry', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const past = new Date(Date.now() - 1000);
    const c1 = await sessionCookieFor(db, u.id);
    await db.update(sessions).set({ expiresAt: past }).where(eq(sessions.id, hashToken(c1.split('=')[1] ?? '')));
    expect(await getSessionUser(db, reqWithCookie(c1))).toBeNull();
    const c2 = await sessionCookieFor(db, u.id);
    await db.update(sessions).set({ idleExpiresAt: past }).where(eq(sessions.id, hashToken(c2.split('=')[1] ?? '')));
    expect(await getSessionUser(db, reqWithCookie(c2))).toBeNull();
  });

  it('rejects sessions of disabled users', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const cookie = await sessionCookieFor(db, u.id);
    await db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, u.id));
    expect(await getSessionUser(db, reqWithCookie(cookie))).toBeNull();
  });

  it('revokeAllSessions removes every session of the user', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    await sessionCookieFor(db, u.id);
    await sessionCookieFor(db, u.id);
    await revokeAllSessions(db, u.id);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});

describe('session cookie header', () => {
  it('uses __Host- prefix with HttpOnly, Secure, SameSite=Lax, and Max-Age only when remembered', () => {
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60);
    const noRemember = sessionCookieHeader('abc_-123', { remember: false, expiresAt });
    expect(noRemember).toMatch(/^__Host-as_session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    const remember = sessionCookieHeader('abc', { remember: true, expiresAt });
    expect(remember).toContain('; Max-Age=');
    expect(clearSessionCookieHeader()).toContain('Max-Age=0');
  });
});

describe('withAuth', () => {
  const guarded = withAuth({ permission: 'analytics.read' }, async (_req, ctx) => json({ user: ctx.user?.email }));

  it('returns 401 envelope without a session', async () => {
    const res = await call(guarded);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('returns 403 for a role lacking the permission', async () => {
    const db = getDb();
    const seller = await createUser(db, { role: 'SELLER' });
    const res = await call(guarded, { cookie: await sessionCookieFor(db, seller.id) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it('passes a permitted user through to the handler', async () => {
    const db = getDb();
    const manager = await createUser(db, { role: 'MANAGER' });
    const res = await call(guarded, { cookie: await sessionCookieFor(db, manager.id) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: manager.email });
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('echoes an incoming request id', async () => {
    const res = await call(withAuth({ public: true }, async () => json({})), { headers: { 'x-request-id': 'req-123' } });
    expect(res.headers.get('X-Request-Id')).toBe('req-123');
  });

  it('{ auth: true } admits any authenticated user and rejects anonymous', async () => {
    const db = getDb();
    const seller = await createUser(db, { role: 'SELLER' });
    const anyUser = withAuth({ auth: true }, async (_req, ctx) => json({ role: ctx.user?.role }));
    expect((await call(anyUser)).status).toBe(401);
    const res = await call(anyUser, { cookie: await sessionCookieFor(db, seller.id) });
    expect(await res.json()).toEqual({ role: 'SELLER' });
  });

  it('{ public: true } runs without a session', async () => {
    const res = await call(withAuth({ public: true }, async (_req, ctx) => json({ user: ctx.user })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });

  it('converts thrown errors to the envelope and never leaks details', async () => {
    const boom = withAuth({ public: true }, async () => {
      throw new Error('secret detail');
    });
    const res = await call(boom);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL', message: 'Internal error' } });
    expect(text).not.toContain('secret detail');
  });

  it('attaches its options as a non-enumerable .auth for introspection', () => {
    const fn = withAuth({ permission: 'audit.read' }, async () => json({}));
    expect(fn.auth).toEqual({ permission: 'audit.read' });
    expect(Object.keys(fn)).not.toContain('auth');
  });
});

describe('stripCostFields', () => {
  it('removes forbidden keys at any depth', () => {
    const out = stripCostFields({
      a: { costPrice: 1, keep: true, items: [{ profit: 2, name: 'n', nested: { marginPct: 3, unitCost: 4 } }] },
      defaultCost: 5,
    });
    expect(out).toEqual({ a: { keep: true, items: [{ name: 'n', nested: {} }] } });
  });
});
