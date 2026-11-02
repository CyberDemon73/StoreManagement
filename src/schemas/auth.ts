import { z } from 'zod';
import { isCommonPassword } from '@/lib/password';
import { emailSchema } from './common';

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => !isCommonPassword(p), { message: 'Password is too common' });

export const setupBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: emailSchema,
    password: passwordSchema,
    storeName: z.string().trim().min(1).max(100),
    currency: z.string().trim().toUpperCase().length(3),
    setupToken: z.string().min(1),
  })
  .strict();
export type SetupInput = z.infer<typeof setupBody>;

export const loginBody = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
    remember: z.boolean().optional().default(false),
  })
  .strict();
export type LoginInput = z.infer<typeof loginBody>;

export const forgotBody = z.object({ email: emailSchema }).strict();
export type ForgotInput = z.infer<typeof forgotBody>;

export const resetBody = z
  .object({
    token: z.string().min(20).max(200),
    password: passwordSchema,
  })
  .strict();
export type ResetInput = z.infer<typeof resetBody>;
