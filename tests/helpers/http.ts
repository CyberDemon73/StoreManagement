import type { RouteHandler } from '@/lib/auth';

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path?: string;
  body?: unknown;
  /** Multipart body; sent as-is (no JSON content-type). */
  form?: FormData;
  cookie?: string | null;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  ip?: string;
}

/** Invoke a route handler the way Next would, with the CSRF headers a real browser client sends. */
export async function call(handler: RouteHandler, opts: CallOptions = {}): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers = new Headers({
    origin: 'http://localhost:3000',
    'x-requested-with': 'AvenueStock',
    'x-forwarded-for': opts.ip ?? '203.0.113.10',
    'user-agent': 'vitest',
    ...opts.headers,
  });
  if (opts.cookie) headers.set('cookie', opts.cookie);
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(opts.body);
  }
  const req = new Request(`http://localhost:3000${opts.path ?? '/api/v1/test'}`, { method, headers, body });
  return handler(req, { params: Promise.resolve(opts.params ?? {}) });
}

/** Value of a Set-Cookie header for `name`, or null. Returns the full attribute string. */
export function readSetCookie(res: Response, name: string): string | null {
  const all = res.headers.getSetCookie?.() ?? [];
  const found = all.find((c) => c.startsWith(`${name}=`));
  return found ?? null;
}

/** `name=value` pair suitable for a Cookie request header, extracted from Set-Cookie. */
export function cookiePair(res: Response, name: string): string | null {
  const raw = readSetCookie(res, name);
  if (!raw) return null;
  return raw.split(';')[0] ?? null;
}
