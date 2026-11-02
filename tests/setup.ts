// Env must be set before any src module reads getEnv(). Grows in Task 4 (test DB).
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
export {};
