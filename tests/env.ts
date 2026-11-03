// Runs before tests/setup.ts and before any src module is imported (vitest setupFiles order),
// so getEnv() never caches the real environment.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_URL: 'http://localhost:3000',
  SETUP_TOKEN: 'test-setup-token',
  SESSION_SECRET: 'dGVzdC1zZXNzaW9uLXNlY3JldC0zMi1ieXRlcy1sb25nISE=',
  DATABASE_URL: '',
  DATABASE_URL_UNPOOLED: '',
  UPSTASH_REDIS_REST_URL: '',
  UPSTASH_REDIS_REST_TOKEN: '',
  RESEND_API_KEY: '',
});
export {};
