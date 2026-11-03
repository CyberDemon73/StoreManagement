import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as forgot } from '@/app/api/v1/auth/forgot/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as reset } from '@/app/api/v1/auth/reset/route';
import { getDb } from '@/db/client';
import { passwordResetTokens } from '@/db/schema';
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
