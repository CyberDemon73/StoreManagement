import { afterAll, beforeAll, beforeEach } from 'vitest';
import { setDb } from '@/db/client';
import { createTestDb, truncateAll, type TestDb } from './helpers/db';

// Env must be set before any src module reads getEnv().
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_URL: 'http://localhost:3000',
  SETUP_TOKEN: 'test-setup-token',
  SESSION_SECRET: 'dGVzdC1zZXNzaW9uLXNlY3JldC0zMi1ieXRlcy1sb25nISE=',
  DATABASE_URL: '',
  UPSTASH_REDIS_REST_URL: '',
  UPSTASH_REDIS_REST_TOKEN: '',
  RESEND_API_KEY: '',
});

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
