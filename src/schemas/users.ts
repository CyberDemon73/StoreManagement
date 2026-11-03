import { z } from 'zod';
import { passwordSchema } from './auth';
import { emailSchema } from './common';

const roleSchema = z.enum(['ADMIN', 'MANAGER', 'SELLER']);
const nameSchema = z.string().trim().min(1).max(100);

export const createUserBody = z
  .object({
    name: nameSchema,
    email: emailSchema,
    role: roleSchema,
    mode: z.enum(['INVITE', 'TEMP']),
  })
  .strict();
export type CreateUserInput = z.infer<typeof createUserBody>;

export const patchUserBody = z
  .object({
    name: nameSchema.optional(),
    role: roleSchema.optional(),
  })
  .strict()
  .refine((p) => p.name !== undefined || p.role !== undefined, { message: 'Nothing to update' });
export type PatchUserInput = z.infer<typeof patchUserBody>;

export const resetPasswordBody = z.object({ mode: z.enum(['EMAIL', 'TEMP']) }).strict();
export type ResetPasswordInput = z.infer<typeof resetPasswordBody>;

export const acceptInviteBody = z
  .object({
    token: z.string().min(20).max(200),
    password: passwordSchema,
  })
  .strict();
export type AcceptInviteInput = z.infer<typeof acceptInviteBody>;
