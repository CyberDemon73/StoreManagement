import { z } from 'zod';
import { isCommonPassword } from '@/lib/password';

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => !isCommonPassword(p), { message: 'Password is too common' });
