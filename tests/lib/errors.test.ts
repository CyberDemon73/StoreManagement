import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, STATUS_BY_CODE } from '@/lib/errors';
import { describeError, errorResponse, getClientIp, json, noContent } from '@/lib/http';

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

  it('API responses are never cached', () => {
    expect(json({}).headers.get('Cache-Control')).toBe('no-store');
    expect(noContent().headers.get('Cache-Control')).toBe('no-store');
  });

  it('describeError() never includes query params or the raw message of a database error', () => {
    const dbErr = Object.assign(new Error('Failed query: insert into users ... params: $argon2id$v=19$m=65536,t=3,p=1$abc'), {
      name: 'DrizzleQueryError',
      params: ['owner@example.com', '$argon2id$v=19$m=65536,t=3,p=1$abc'],
      cause: Object.assign(new Error('duplicate key value violates unique constraint "users_email_unique"'), { code: '23505' }),
    });
    const described = describeError(dbErr);
    const text = JSON.stringify(described);
    expect(text).not.toContain('argon2id');
    expect(text).not.toContain('owner@example.com');
    expect(described).toMatchObject({ name: 'DrizzleQueryError', code: '23505' });
    expect(describeError(new Error('plain'))).toMatchObject({ name: 'Error', message: 'plain' });
  });
});

describe('getClientIp', () => {
  function withHeaders(h: Record<string, string>) {
    return new Request('http://localhost:3000/x', { headers: h });
  }
  it('returns the first valid forwarded address', () => {
    expect(getClientIp(withHeaders({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
    expect(getClientIp(withHeaders({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(getClientIp(withHeaders({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
  });
  it('returns null for anything that is not an IP address', () => {
    expect(getClientIp(withHeaders({ 'x-forwarded-for': 'garbage' }))).toBeNull();
    expect(getClientIp(withHeaders({ 'x-forwarded-for': '1.2.3.4:5678' }))).toBeNull();
    expect(getClientIp(withHeaders({ 'x-real-ip': 'unknown' }))).toBeNull();
    expect(getClientIp(withHeaders({}))).toBeNull();
  });
});
