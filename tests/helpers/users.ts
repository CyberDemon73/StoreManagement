import type { Db } from '@/db/client';
import { users } from '@/db/schema';
import { createSession, SESSION_COOKIE } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import type { Role } from '@/lib/permissions';

export const DEFAULT_PASSWORD = 'Correct-Horse-Battery-9';

// Hash once per process: argon2id at 64 MiB is ~100 ms per call.
const hashCache = new Map<string, Promise<string>>();
function cachedHash(password: string): Promise<string> {
  let p = hashCache.get(password);
  if (!p) {
    p = hashPassword(password);
    hashCache.set(password, p);
  }
  return p;
}

export interface CreatedUser {
  id: string;
  email: string;
  password: string;
  role: Role;
}

let seq = 0;

export async function createUser(
  db: Db,
  opts: { role: Role; email?: string; password?: string; name?: string; status?: 'ACTIVE' | 'DISABLED' },
): Promise<CreatedUser> {
  const password = opts.password ?? DEFAULT_PASSWORD;
  const email = opts.email ?? `${opts.role.toLowerCase()}${++seq}@example.com`;
  const [row] = await db
    .insert(users)
    .values({
      name: opts.name ?? opts.role,
      email,
      passwordHash: await cachedHash(password),
      role: opts.role,
      status: opts.status ?? 'ACTIVE',
    })
    .returning({ id: users.id });
  if (!row) throw new Error('insert failed');
  return { id: row.id, email, password, role: opts.role };
}

/** Creates a live session and returns the Cookie header value for it. */
export async function sessionCookieFor(db: Db, userId: string, remember = false): Promise<string> {
  const s = await createSession(db, { userId, ip: '203.0.113.10', userAgent: 'vitest', remember });
  return `${SESSION_COOKIE}=${s.raw}`;
}
