// Edge-safe: no Node-only imports (this file is used by middleware).

/** Policy from docs/SECURITY.md. `unsafe-eval` is required only by Next.js dev tooling (HMR). */
export function buildCsp(nonce: string, isDev: boolean): string {
  const script = `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}`;
  return [
    "default-src 'self'",
    "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    script,
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), geolocation=(), microphone=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export const REQUESTED_WITH_VALUE = 'AvenueStock';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Non-GET requests must come from our own origin (Origin, falling back to Referer) and carry the
 * custom header a cross-site form post cannot set.
 */
export function isCsrfSafe(req: Request, appOrigin: string): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const origin = originOf(req.headers.get('origin')) ?? originOf(req.headers.get('referer'));
  if (origin !== appOrigin) return false;
  return req.headers.get('x-requested-with') === REQUESTED_WITH_VALUE;
}

export function isValidRequestId(value: string | null): value is string {
  return !!value && /^[A-Za-z0-9-]{1,64}$/.test(value);
}
