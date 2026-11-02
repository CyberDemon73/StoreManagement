import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { parse } from '@/lib/validate';
import { paginationQuery } from '@/schemas/common';

const schema = z.object({ a: z.string() }).strict();

function req(body: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

async function expectAppError(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error('expected to throw');
}

describe('parse', () => {
  it('returns typed data for a valid JSON body', async () => {
    await expect(parse(schema, req(JSON.stringify({ a: 'x' })))).resolves.toEqual({ a: 'x' });
  });

  it('rejects unknown keys with VALIDATION and a field entry', async () => {
    const err = await expectAppError(parse(schema, req(JSON.stringify({ a: 'x', b: 1 }))));
    expect(err.code).toBe('VALIDATION');
    expect(err.status).toBe(400);
    expect(err.fields?.b ?? err.fields?._).toBeTypeOf('string');
  });

  it('rejects invalid JSON with a clear message, not a 500', async () => {
    const err = await expectAppError(parse(schema, req('{')));
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toBe('Invalid JSON body');
  });

  it('rejects bodies over 1 MB with 413', async () => {
    const err = await expectAppError(parse(schema, req('{}', { 'content-length': '2000000' })));
    expect(err.code).toBe('VALIDATION');
    expect(err.status).toBe(413);
  });

  it('parses URLSearchParams with coercion and defaults', async () => {
    await expect(parse(paginationQuery, new URLSearchParams('page=2'))).resolves.toEqual({ page: 2, pageSize: 25 });
    const err = await expectAppError(parse(paginationQuery, new URLSearchParams('pageSize=500')));
    expect(err.fields?.pageSize).toBeTypeOf('string');
  });

  it('parses plain objects', async () => {
    await expect(parse(schema, { a: 'y' })).resolves.toEqual({ a: 'y' });
  });
});
