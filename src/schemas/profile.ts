import { z } from 'zod';
import { passwordSchema } from './auth';

export const meBody = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export type MeInput = z.infer<typeof meBody>;

export const passwordChangeBody = z
  .object({
    current: z.string().min(1).max(128),
    next: passwordSchema,
  })
  .strict();
export type PasswordChangeInput = z.infer<typeof passwordChangeBody>;
