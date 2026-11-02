import { describe, expect, it } from 'vitest';

async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return ((e as Error).cause as { code?: string } | undefined)?.code;
  }
  return undefined;
}
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { auditLog, failedLogins, passwordResetTokens, sessions, settings, users } from '@/db/schema';

describe('schema v1', () => {
  it('creates all Sprint 0 tables, empty after reset', async () => {
    const db = getDb();
    expect(await db.select().from(users)).toEqual([]);
    expect(await db.select().from(sessions)).toEqual([]);
    expect(await db.select().from(passwordResetTokens)).toEqual([]);
    expect(await db.select().from(failedLogins)).toEqual([]);
    expect(await db.select().from(settings)).toEqual([]);
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it('treats user emails case-insensitively (citext unique)', async () => {
    const db = getDb();
    await db.insert(users).values({ name: 'a', email: 'a@x.com', passwordHash: 'h', role: 'ADMIN' });
    expect(await pgCode(db.insert(users).values({ name: 'b', email: 'A@X.COM', passwordHash: 'h', role: 'SELLER' }))).toBe('23505');
    const found = await db.select().from(users).where(sql`${users.email} = 'A@x.COM'`);
    expect(found).toHaveLength(1);
  });

  it('allows only a single settings row (id = 1)', async () => {
    const db = getDb();
    await db.insert(settings).values({});
    const [row] = await db.select().from(settings);
    expect(row?.id).toBe(1);
    expect(row?.currency).toBe('EGP');
    expect(row?.timezone).toBe('Africa/Cairo');
    expect(await pgCode(db.insert(settings).values({ id: 2 }))).toBe('23514');
  });

  it('defaults users to ACTIVE with timestamps', async () => {
    const db = getDb();
    const [u] = await db.insert(users).values({ name: 'a', email: 'c@x.com', passwordHash: 'h', role: 'MANAGER' }).returning();
    expect(u?.status).toBe('ACTIVE');
    expect(u?.mustChangePassword).toBe(false);
    expect(u?.createdAt).toBeInstanceOf(Date);
  });
});
