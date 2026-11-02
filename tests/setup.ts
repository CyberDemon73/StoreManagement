// Env must be set before any src module reads getEnv(). Grows in Task 4 (test DB).
Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'silent' });
export {};
