import { ZodError, type ZodType } from 'zod';
import { AppError } from './errors';
import { zodFields } from './http';

export const MAX_BODY_BYTES = 1_048_576;

/**
 * Validate a request body, query string or plain value against a strict Zod schema.
 * Throws AppError('VALIDATION') with per-field messages; never leaks the raw Zod error.
 */
export async function parse<T>(schema: ZodType<T>, source: Request | URLSearchParams | unknown): Promise<T> {
  const input = await toInput(source);
  // Postgres text cannot hold U+0000; letting it through turns a typo into a 500 at query time.
  if (hasNul(input)) throw new AppError('VALIDATION', 'Invalid input', { fields: { _: 'NUL characters are not allowed' } });
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AppError('VALIDATION', 'Invalid input', { fields: zodFields(err) });
    }
    throw err;
  }
}

function hasNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 32 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => hasNul(v, depth + 1));
  return Object.entries(value).some(([k, v]) => k.includes('\u0000') || hasNul(v, depth + 1));
}

async function toInput(source: Request | URLSearchParams | unknown): Promise<unknown> {
  if (source instanceof URLSearchParams) {
    return Object.fromEntries(source.entries());
  }
  if (source instanceof Request) {
    const len = Number(source.headers.get('content-length') ?? 0);
    if (len > MAX_BODY_BYTES) {
      throw new AppError('VALIDATION', 'Request body too large', { status: 413 });
    }
    const text = await source.text();
    if (text.length > MAX_BODY_BYTES) {
      throw new AppError('VALIDATION', 'Request body too large', { status: 413 });
    }
    if (text.trim() === '') return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError('VALIDATION', 'Invalid JSON body');
    }
  }
  return source;
}
