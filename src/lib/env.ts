import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).default('Avenue Stock <no-reply@localhost>'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(1).optional(),
  SETUP_TOKEN: z.string().min(16).optional(),
  CRON_SECRET: z.string().min(1).optional(),
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
}).superRefine((env, ctx) => {
  // Production must never silently fall back to in-memory limiters, logged emails, or localhost links.
  if (env.VERCEL_ENV !== 'production') return;
  const required = [
    'DATABASE_URL',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'RESEND_API_KEY',
    'SETUP_TOKEN',
  ] as const;
  for (const key of required) {
    if (!env[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required in production` });
  }
  if (env.APP_URL.startsWith('http://localhost')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['APP_URL'], message: 'APP_URL is required in production' });
  }
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Validated process.env, parsed once. Empty strings count as unset. */
export function getEnv(): Env {
  if (cached) return cached;
  const raw: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) raw[k] = v === '' ? undefined : v;
  cached = envSchema.parse(raw);
  return cached;
}

export function resetEnvForTests(): void {
  cached = null;
}
