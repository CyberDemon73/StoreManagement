import { describe, expect, it } from 'vitest';
import { getDummyHash, hashPassword, isCommonPassword, verifyPassword } from '@/lib/password';
import { passwordSchema } from '@/schemas/auth';

describe('password hashing', () => {
  it('produces an argon2id hash with the documented parameters', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-9');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=65536,t=3,p=1');
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-9');
    expect(await verifyPassword(hash, 'Correct-Horse-Battery-9')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password-123')).toBe(false);
  });

  it('exposes a stable dummy hash for timing-safe unknown-user logins', async () => {
    const a = await getDummyHash();
    expect(a.startsWith('$argon2id$')).toBe(true);
    expect(await getDummyHash()).toBe(a);
    expect(await verifyPassword(a, 'anything')).toBe(false);
  });
});

describe('common password list', () => {
  it('flags well-known passwords, case-insensitively', () => {
    expect(isCommonPassword('password123')).toBe(true);
    expect(isCommonPassword('PASSWORD123')).toBe(true);
    expect(isCommonPassword('Zq9!vt-plume-orbit')).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('enforces length 10..128 and rejects common passwords', () => {
    expect(passwordSchema.safeParse('123456789').success).toBe(false);
    expect(passwordSchema.safeParse('password1234').success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(passwordSchema.safeParse('Zq9!vt-plume-orbit').success).toBe(true);
    const r = passwordSchema.safeParse('password1234');
    expect(r.success ? '' : r.error.issues[0]?.message).toBe('Password is too common');
  });
});
