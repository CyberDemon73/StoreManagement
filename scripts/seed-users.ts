/**
 * Adds demo staff accounts (one MANAGER, two SELLERs) to the database in DATABASE_URL.
 * Idempotent by email: existing accounts are left untouched. Each new account gets a random
 * 16-character password that is printed once and never stored in plain text.
 *
 * Usage: pnpm db:seed-users
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { users } from '@/db/schema';
import { audit } from '@/lib/audit';
import { hashPassword } from '@/lib/password';
import { generateTemporaryPassword } from '@/services/users';

const STAFF = [
  { name: 'Mona Manager', email: 'manager@example.com', role: 'MANAGER' },
  { name: 'Sara Seller', email: 'seller1@example.com', role: 'SELLER' },
  { name: 'Omar Seller', email: 'seller2@example.com', role: 'SELLER' },
] as const;

async function main(): Promise<void> {
  const db = getDb();
  const created: { email: string; role: string; password: string }[] = [];
  for (const s of STAFF) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, s.email)).limit(1);
    if (existing) {
      console.log(`exists   ${s.role.padEnd(8)} ${s.email}`);
      continue;
    }
    const password = generateTemporaryPassword();
    const [row] = await db
      .insert(users)
      .values({ name: s.name, email: s.email, role: s.role, passwordHash: await hashPassword(password) })
      .returning({ id: users.id });
    if (!row) throw new Error(`insert failed for ${s.email}`);
    await audit(db, { userId: null }, 'user.seed', 'user', row.id, null, { name: s.name, email: s.email, role: s.role });
    created.push({ email: s.email, role: s.role, password });
  }
  for (const c of created) console.log(`created  ${c.role.padEnd(8)} ${c.email}  password: ${c.password}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
