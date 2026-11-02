import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, STATUS_BY_CODE } from '@/lib/errors';
import { errorResponse, json, noContent } from '@/lib/http';

describe('AppError + errorResponse', () => {
  it('maps LOCKED to 423 with retryAfter in body and header', async () => {
    const res = errorResponse(new AppError('LOCKED', 'locked', { retryAfter: 30 }));
    expect(res.status).toBe(423);
    expect(res.headers.get('Retry-After')).toBe('30');
    const body = await res.json();
    expect(body).toEqual({ error: { code: 'LOCKED', message: 'locked', retryAfter: 30 } });
  });

  it('hides unknown errors behind a generic 500 envelope', async () => {
    const res = errorResponse(new Error('boom: SELECT * FROM users'));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL', message: 'Internal error' } });
    expect(text).not.toContain('boom');
    expect(text).not.toContain('stack');
  });

  it('maps ZodError to 400 VALIDATION with fields', async () => {
    const result = z.object({ a: z.string() }).strict().safeParse({ a: 1, b: 2 });
    expect(result.success).toBe(false);
    if (result.success) return;
    const res = errorResponse(result.error);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.fields.a).toBeTypeOf('string');
  });

  it('has a status for every code', () => {
    expect(STATUS_BY_CODE).toEqual({
      VALIDATION: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
      RATE_LIMITED: 429, LOCKED: 423, INSUFFICIENT_STOCK: 409, INTERNAL: 500,
    });
  });

  it('json() and noContent() set status and content type', async () => {
    const res = json({ ok: true }, 201, { 'X-Test': '1' });
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('X-Test')).toBe('1');
    expect(await res.json()).toEqual({ ok: true });
    expect(noContent().status).toBe(204);
  });
});
