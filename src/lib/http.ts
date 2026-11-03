import { isIP } from 'node:net';
import { ZodError } from 'zod';
import { AppError, type ErrorEnvelope } from './errors';
import { logger } from './logger';

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  // API responses are per-user and cookie-authenticated: never let a shared cache keep them.
  h.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function noContent(headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Cache-Control', 'no-store');
  return new Response(null, { status: 204, headers: h });
}

/** Flatten Zod issues to { "path.to.field": message }. Root issues use "_". */
export function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const prefix = issue.path.map(String).join('.');
    // Strict schemas report unknown keys as one root issue; surface each key by name instead.
    if (issue.code === 'unrecognized_keys') {
      for (const k of issue.keys) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (!(key in fields)) fields[key] = 'Unknown field';
      }
      continue;
    }
    const key = prefix || '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export interface DescribedError {
  name: string;
  message?: string;
  code?: string;
  stack?: string;
}

/**
 * Log-safe view of an error. Database driver errors embed the SQL and its bound parameters
 * (password hashes, emails, token hashes) in `message`/`params`, so for those only the
 * Postgres error code and the cause's message are kept.
 */
export function describeError(err: unknown): DescribedError {
  if (!(err instanceof Error)) return { name: 'NonError', message: String(err) };
  const cause = err.cause as { code?: unknown; message?: unknown } | undefined;
  const isQueryError = err.name === 'DrizzleQueryError' || 'params' in err || /^Failed query/.test(err.message);
  const out: DescribedError = { name: err.name };
  if (isQueryError) {
    if (typeof cause?.code === 'string') out.code = cause.code;
    if (typeof cause?.message === 'string') out.message = cause.message;
  } else {
    out.message = err.message;
    if (typeof cause?.code === 'string') out.code = cause.code;
  }
  if (err.stack) {
    // The first stack line repeats the message; keep only the frames.
    const frames = err.stack.split('\n').filter((l) => /^\s+at /.test(l));
    out.stack = frames.slice(0, 8).join('\n');
  }
  return out;
}

/** Turn any thrown value into the uniform error envelope. Unknown errors are logged, never exposed. */
export function errorResponse(err: unknown, requestId?: string): Response {
  const extra: HeadersInit = requestId ? { 'X-Request-Id': requestId } : {};

  if (err instanceof AppError) {
    const body: ErrorEnvelope = { error: { code: err.code, message: err.message } };
    if (err.fields) body.error.fields = err.fields;
    const headers = new Headers(extra);
    if (err.retryAfter !== undefined) {
      body.error.retryAfter = err.retryAfter;
      headers.set('Retry-After', String(err.retryAfter));
    }
    return json(body, err.status, headers);
  }

  if (err instanceof ZodError) {
    const body: ErrorEnvelope = {
      error: { code: 'VALIDATION', message: 'Invalid input', fields: zodFields(err) },
    };
    return json(body, 400, extra);
  }

  logger.error({ err: describeError(err), requestId }, 'unhandled error');
  const body: ErrorEnvelope = { error: { code: 'INTERNAL', message: 'Internal error' } };
  return json(body, 500, extra);
}

/** First forwarded hop, only if it is a syntactically valid IPv4/IPv6 address (the columns are `inet`). */
export function getClientIp(req: Request): string | null {
  const candidates = [req.headers.get('x-forwarded-for')?.split(',')[0], req.headers.get('x-real-ip')];
  for (const c of candidates) {
    const v = c?.trim();
    if (v && isIP(v) !== 0) return v;
  }
  return null;
}

export function getUserAgent(req: Request): string | null {
  const ua = req.headers.get('user-agent');
  return ua ? ua.slice(0, 512) : null;
}
