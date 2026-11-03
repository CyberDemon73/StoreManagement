import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as forgot } from '@/app/api/v1/auth/forgot/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as reset } from '@/app/api/v1/auth/reset/route';
import { POST as mePassword } from '@/app/api/v1/me/password/route';
import { POST as disableUser } from '@/app/api/v1/users/[id]/disable/route';
import { POST as adminReset } from '@/app/api/v1/users/[id]/reset-password/route';
import { PATCH as patchUser } from '@/app/api/v1/users/[id]/route';
import { getDb } from '@/db/client';
import { passwordResetTokens, users } from '@/db/schema';
import { setEmailTransportForTests, type OutgoingEmail } from '@/lib/email';
import { resetMemoryLimiters } from '@/lib/ratelimit';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

const sent: OutgoingEmail[] = [];

beforeEach(() => {
  sent.length = 0;
  resetMemoryLimiters();
  setEmailTransportForTests(async (mail) => {
    sent.push(mail);
  });
});
afterEach(() => setEmailTransportForTests(null));

function tokenFrom(mail: OutgoingEmail | undefined): string {
  const m = mail?.text.match(/\/reset\?token=([A-Za-z0-9_-]+)/);
  if (!m?.[1]) throw new Error('no token in email');
  return m[1];
}

const NEW_PASSWORD = 'Vx7!river-copper-lamp';

describe('POST /auth/forgot', () => {
  it('emails a reset link to an existing user and returns 204', async () => {
    const u = await createUser(getDb(), { role: 'SELLER' });
    const res = await call(forgot, { method: 'POST', path: '/api/v1/auth/forgot', body: { email: u.email } });
    expect(res.status).toBe(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(u.email);
    expect(sent[0]?.text).toContain('http://localhost:3000/reset?token=');
    expect(sent[0]?.html).toContain('Choose a new password');
    expect(sent[0]?.html).toContain('href="http://localhost:3000/reset?token=');
    const rows = await getDb().select().from(passwordResetTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.purpose).toBe('RESET');
    expect(rows[0]?.tokenHash).not.toBe(tokenFrom(sent[0]));
  });

  it('returns 204 and sends nothing for an unknown email', async () => {
    const res = await call(forgot, { method: 'POST', path: '/api/v1/auth/forgot', body: { email: 'ghost@example.com' } });
    expect(res.status).toBe(204);
    expect(sent).toHaveLength(0);
  });

  it('limits to 3 requests per email per hour', async () => {
    const u = await createUser(getDb(), { role: 'SELLER' });
    for (let i = 0; i < 3; i++) {
      expect((await call(forgot, { method: 'POST', path: '/api/v1/auth/forgot', body: { email: u.email } })).status).toBe(204);
    }
    const fourth = await call(forgot, { method: 'POST', path: '/api/v1/auth/forgot', body: { email: u.email } });
    expect(fourth.status).toBe(429);
  });
});

describe('POST /auth/reset', () => {
  async function requestToken(email: string): Promise<string> {
    await call(forgot, { method: 'POST', path: '/api/v1/auth/forgot', body: { email } });
    return tokenFrom(sent.at(-1));
  }

  it('sets the new password, revokes existing sessions, and allows login with it', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    const oldCookie = await sessionCookieFor(db, u.id);
    const token = await requestToken(u.email);

    const res = await call(reset, { method: 'POST', path: '/api/v1/auth/reset', body: { token, password: NEW_PASSWORD } });
    expect(res.status).toBe(204);

    expect((await call(me, { path: '/api/v1/auth/me', cookie: oldCookie })).status).toBe(401);
    const oldLogin = await call(login, { method: 'POST', path: '/api/v1/auth/login', body: { email: u.email, password: u.password } });
    expect(oldLogin.status).toBe(401);
    const newLogin = await call(login, { method: 'POST', path: '/api/v1/auth/login', body: { email: u.email, password: NEW_PASSWORD } });
    expect(newLogin.status).toBe(200);
  });

  it('rejects a reused token', async () => {
    const u = await createUser(getDb(), { role: 'SELLER' });
    const token = await requestToken(u.email);
    expect((await call(reset, { method: 'POST', path: '/api/v1/auth/reset', body: { token, password: NEW_PASSWORD } })).status).toBe(204);
    const again = await call(reset, { method: 'POST', path: '/api/v1/auth/reset', body: { token, password: 'Another-good-pass-42' } });
    expect(again.status).toBe(400);
    expect((await again.json()).error.message).toBe('Invalid or expired token');
  });

  it('rejects an expired token', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const token = await requestToken(u.email);
    await db.update(passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResetTokens.userId, u.id));
    const res = await call(reset, { method: 'POST', path: '/api/v1/auth/reset', body: { token, password: NEW_PASSWORD } });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown token and a weak password', async () => {
    const unknown = await call(reset, { method: 'POST', path: '/api/v1/auth/reset', body: { token: 'x'.repeat(43), password: NEW_PASSWORD } });
    expect(unknown.status).toBe(400);
    const u = await createUser(getDb(), { role: 'SELLER' });
    const token = await requestToken(u.email);
    const weak = await call(reset, { method: 'POST', path: '/api/v1/auth/reset', body: { token, password: 'password1234' } });
    expect(weak.status).toBe(400);
    expect((await weak.json()).error.fields.password).toBe('Password is too common');
  });
});

describe('hardening', () => {
  it('forgot still returns 204 when the email provider fails', async () => {
    const u = await createUser(getDb(), { role: 'SELLER' });
    setEmailTransportForTests(async () => {
      throw new Error('resend down');
    });
    const res = await call(forgot, { method: 'POST', path: '/api/v1/auth/forgot', body: { email: u.email } });
    expect(res.status).toBe(204);
  });

  it('a successful reset invalidates the user’s other outstanding reset tokens', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    await call(forgot, { method: 'POST', path: '/api/v1/auth/forgot', body: { email: u.email } });
    const tokenA = tokenFrom(sent.at(-1));
    await call(forgot, { method: 'POST', path: '/api/v1/auth/forgot', body: { email: u.email } });
    const tokenB = tokenFrom(sent.at(-1));
    expect((await call(reset, { method: 'POST', path: '/api/v1/auth/reset', body: { token: tokenB, password: NEW_PASSWORD } })).status).toBe(204);
    const withA = await call(reset, { method: 'POST', path: '/api/v1/auth/reset', body: { token: tokenA, password: 'Another-good-pass-42' } });
    expect(withA.status).toBe(400);
    const open = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, u.id));
    expect(open.every((t) => t.usedAt !== null)).toBe(true);
  });

  it('limits public auth routes per IP (20/h) — forgot', async () => {
    for (let i = 0; i < 20; i++) {
      const r = await call(forgot, { method: 'POST', path: '/api/v1/auth/forgot', body: { email: `p${i}@example.com` }, ip: '10.9.9.9' });
      expect(r.status).toBe(204);
    }
    const blocked = await call(forgot, { method: 'POST', path: '/api/v1/auth/forgot', body: { email: 'p99@example.com' }, ip: '10.9.9.9' });
    expect(blocked.status).toBe(429);
    const reset21 = await call(reset, { method: 'POST', path: '/api/v1/auth/reset', body: { token: 'x'.repeat(43), password: NEW_PASSWORD }, ip: '10.9.9.9' });
    expect(reset21.status).toBe(429);
  });
});

describe('reset links die with the account state', () => {
  async function requestToken(email: string): Promise<string> {
    await call(forgot, { method: 'POST', path: '/api/v1/auth/forgot', body: { email } });
    return tokenFrom(sent.at(-1));
  }
  function resetWith(token: string) {
    return call(reset, { method: 'POST', path: '/api/v1/auth/reset', body: { token, password: NEW_PASSWORD } });
  }
  async function managerCookie() {
    const db = getDb();
    const m = await createUser(db, { role: 'MANAGER' });
    return sessionCookieFor(db, m.id);
  }

  it('forgot → disable → reset with that token → 400', async () => {
    const u = await createUser(getDb(), { role: 'SELLER' });
    const token = await requestToken(u.email);
    const cookie = await managerCookie();
    expect((await call(disableUser, { method: 'POST', path: `/api/v1/users/${u.id}/disable`, params: { id: u.id }, cookie })).status).toBe(200);
    const res = await resetWith(token);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Invalid or expired token');
  });

  it('a live token for a non-ACTIVE account is rejected even if it was never invalidated', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const token = await requestToken(u.email);
    await db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, u.id));
    const res = await resetWith(token);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Invalid or expired token');
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row?.status).toBe('DISABLED');
  });

  it('forgot → admin TEMP reset → old token 400', async () => {
    const u = await createUser(getDb(), { role: 'SELLER' });
    const token = await requestToken(u.email);
    const cookie = await managerCookie();
    const r = await call(adminReset, { method: 'POST', path: `/api/v1/users/${u.id}/reset-password`, params: { id: u.id }, cookie, body: { mode: 'TEMP' } });
    expect(r.status).toBe(200);
    expect((await resetWith(token)).status).toBe(400);
  });

  it('forgot → admin EMAIL reset → old token 400, new token works', async () => {
    const u = await createUser(getDb(), { role: 'SELLER' });
    const oldToken = await requestToken(u.email);
    const cookie = await managerCookie();
    const r = await call(adminReset, { method: 'POST', path: `/api/v1/users/${u.id}/reset-password`, params: { id: u.id }, cookie, body: { mode: 'EMAIL' } });
    expect(r.status).toBe(200);
    const newToken = tokenFrom(sent.at(-1));
    expect((await resetWith(oldToken)).status).toBe(400);
    expect((await resetWith(newToken)).status).toBe(204);
  });

  it('forgot → role change → old token 400', async () => {
    const u = await createUser(getDb(), { role: 'SELLER' });
    const token = await requestToken(u.email);
    const cookie = await managerCookie();
    const r = await call(patchUser, { method: 'PATCH', path: `/api/v1/users/${u.id}`, params: { id: u.id }, cookie, body: { role: 'MANAGER' } });
    expect(r.status).toBe(200);
    expect((await resetWith(token)).status).toBe(400);
  });

  it('forgot → POST /me/password → old token 400', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'SELLER' });
    const token = await requestToken(u.email);
    const cookie = await sessionCookieFor(db, u.id);
    const r = await call(mePassword, { method: 'POST', path: '/api/v1/me/password', cookie, body: { current: u.password, next: 'Yq8!vt-plume-orbit2' } });
    expect(r.status).toBe(204);
    expect((await resetWith(token)).status).toBe(400);
  });
});
