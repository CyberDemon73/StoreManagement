import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import commonList from './common-passwords.json';

// Parameters from docs/SECURITY.md: Argon2id, 64 MiB, 3 iterations, parallelism 1.
const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;

/** Hash of a random secret; verifying against it costs the same as a real check, hiding whether the email exists. */
export function getDummyHash(): Promise<string> {
  if (!dummy) dummy = hash(randomBytes(32).toString('base64url'), ARGON2_OPTIONS);
  return dummy;
}

const COMMON = new Set<string>(commonList as string[]);

export function isCommonPassword(password: string): boolean {
  return COMMON.has(password.trim().toLowerCase());
}
