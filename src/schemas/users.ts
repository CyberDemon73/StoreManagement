import { z } from 'zod';
import { passwordSchema } from './auth';
import { emailSchema } from './common';

const roleSchema = z.enum(['ADMIN', 'MANAGER', 'SELLER']);
const nameSchema = z.string().trim().min(1).max(100);

/**
 * TEMP may carry an admin-chosen `password` (omitted → the server generates one and returns it once)
 * and `mustChange` (default true). Neither means anything for INVITE/EMAIL, so they are rejected there.
 */
const chosenPassword = { password: passwordSchema.optional(), mustChange: z.boolean().optional() };
const onlyWithTemp = (b: { mode: string; password?: string; mustChange?: boolean }, ctx: z.RefinementCtx) => {
  if (b.mode === 'TEMP') return;
  if (b.password !== undefined) ctx.addIssue({ code: 'custom', path: ['password'], message: 'Only with a temporary password' });
  if (b.mustChange !== undefined) ctx.addIssue({ code: 'custom', path: ['mustChange'], message: 'Only with a temporary password' });
};

export const createUserBody = z
  .object({
    name: nameSchema,
    email: emailSchema,
    role: roleSchema,
    mode: z.enum(['INVITE', 'TEMP']),
    ...chosenPassword,
  })
  .strict()
  .superRefine(onlyWithTemp);
export type CreateUserInput = z.infer<typeof createUserBody>;

export const patchUserBody = z
  .object({
    name: nameSchema.optional(),
    role: roleSchema.optional(),
  })
  .strict()
  .refine((p) => p.name !== undefined || p.role !== undefined, { message: 'Nothing to update' });
export type PatchUserInput = z.infer<typeof patchUserBody>;

export const resetPasswordBody = z
  .object({ mode: z.enum(['EMAIL', 'TEMP']), ...chosenPassword })
  .strict()
  .superRefine(onlyWithTemp);
export type ResetPasswordInput = z.infer<typeof resetPasswordBody>;

export const acceptInviteBody = z
  .object({
    token: z.string().min(20).max(200),
    password: passwordSchema,
  })
  .strict();
export type AcceptInviteInput = z.infer<typeof acceptInviteBody>;
