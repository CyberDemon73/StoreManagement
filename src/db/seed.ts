import 'dotenv/config';
import { getDb } from './client';
import { settings } from './schema';

/** Idempotent: guarantees the single settings row exists. Catalogue seed data arrives in Sprint 1. */
export async function seed(db = getDb()): Promise<void> {
  await db.insert(settings).values({}).onConflictDoNothing();
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed()
    .then(() => {
      console.log('seed complete');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
