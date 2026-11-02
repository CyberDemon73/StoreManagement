import { ZodError } from 'zod';
import { AppError, type ErrorEnvelope } from './errors';
import { logger } from './logger';

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function noContent(headers?: HeadersInit): Response {
  return new Response(null, { status: 204, headers });
}

/** Flatten Zod issues to { "path.to.field": message }. Root issues use "_". */
export function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
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

  logger.error({ err, requestId }, 'unhandled error');
  const body: ErrorEnvelope = { error: { code: 'INTERNAL', message: 'Internal error' } };
  return json(body, 500, extra);
}

export function getClientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip');
}

export function getUserAgent(req: Request): string | null {
  const ua = req.headers.get('user-agent');
  return ua ? ua.slice(0, 512) : null;
}
