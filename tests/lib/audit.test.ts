import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { audit } from '@/lib/audit';
import { createUser } from '../helpers/users';

describe('audit()', () => {
  it('writes a row with actor, action, entity and diff', async () => {
    const db = getDb();
    const u = await createUser(db, { role: 'MANAGER' });
    await audit(db, { userId: u.id, ip: '203.0.113.10', userAgent: 'vitest' }, 'user.update', 'user', u.id, { name: 'a' }, { name: 'b' });
    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: u.id, action: 'user.update', entity: 'user', entityId: u.id, before: { name: 'a' }, after: { name: 'b' }, ip: '203.0.113.10', userAgent: 'vitest' });
  });

  it('redacts secret-bearing keys at any depth', async () => {
    const db = getDb();
    await audit(db, { userId: null }, 'setup.complete', 'user', null, null, {
      name: 'n',
      passwordHash: 'x',
      nested: { token: 't', tokenHash: 'h', password: 'p', keep: 1 },
    });
    const [row] = await db.select().from(auditLog);
    expect(row?.after).toEqual({ name: 'n', nested: { keep: 1 } });
    expect(row?.userId).toBeNull();
  });
});
