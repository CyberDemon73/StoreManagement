import { afterAll, beforeAll, beforeEach } from 'vitest';
import { setDb } from '@/db/client';
import { createTestDb, truncateAll, type TestDb } from './helpers/db';

// Env is set in tests/env.ts (listed first in setupFiles).

let testDb: TestDb | null = null;

beforeAll(async () => {
  testDb = await createTestDb();
  setDb(testDb.db);
});

beforeEach(async () => {
  if (testDb) await truncateAll(testDb.db);
});

afterAll(async () => {
  setDb(null);
  await testDb?.close();
});
