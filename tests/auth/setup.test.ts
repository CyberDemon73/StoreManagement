import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/setup/route';
import { getDb } from '@/db/client';
import { auditLog, settings, users } from '@/db/schema';
import { call, readSetCookie } from '../helpers/http';
import { createUser } from '../helpers/users';

const valid = {
  name: 'Owner',
  email: 'Owner@Avenue.eg',
  password: 'Zq9!vt-plume-orbit',
  storeName: 'Avenue',
  currency: 'egp',
  setupToken: 'test-setup-token',
};

function setup(body: unknown) {
  return call(POST, { method: 'POST', path: '/api/v1/setup', body });
}

describe('POST /setup', () => {
  it('creates the first admin, settings row, session cookie and audit entry', async () => {
    const res = await setup(valid);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toMatchObject({ name: 'Owner', email: 'owner@avenue.eg', role: 'ADMIN', status: 'ACTIVE' });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    expect(readSetCookie(res, '__Host-as_session')).toMatch(/HttpOnly; Secure; SameSite=Lax/);

    const db = getDb();
    const [s] = await db.select().from(settings);
    expect(s).toMatchObject({ id: 1, storeName: 'Avenue', currency: 'EGP' });
    const [u] = await db.select().from(users);
    expect(u?.passwordHash.startsWith('$argon2id$')).toBe(true);
    const [a] = await db.select().from(auditLog);
    expect(a).toMatchObject({ action: 'setup.complete', entity: 'user', entityId: u?.id, userId: u?.id });
  });

  it('refuses once any user exists (409 CONFLICT)', async () => {
    await createUser(getDb(), { role: 'SELLER' });
    const res = await setup(valid);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT');
  });

  it('refuses a wrong setup token (403) and creates nothing', async () => {
    const res = await setup({ ...valid, setupToken: 'nope' });
    expect(res.status).toBe(403);
    expect(await getDb().select().from(users)).toHaveLength(0);
  });

  it('rejects unknown fields (400) and weak passwords with a field message', async () => {
    const extra = await setup({ ...valid, role: 'ADMIN' });
    expect(extra.status).toBe(400);
    expect((await extra.json()).error.fields.role).toBeTypeOf('string');

    const weak = await setup({ ...valid, password: 'password1234' });
    expect(weak.status).toBe(400);
    expect((await weak.json()).error.fields.password).toBe('Password is too common');
  });
});
