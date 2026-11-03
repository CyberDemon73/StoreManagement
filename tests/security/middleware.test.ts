import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import middleware from '@/middleware';
import { buildCsp, SECURITY_HEADERS } from '@/lib/security-headers';

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? 'GET', headers: init.headers });
}

describe('security headers', () => {
  it('sets every header from docs/SECURITY.md on a page response', async () => {
    const res = await middleware(req('/'));
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains; preload');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(self), geolocation=(), microphone=()');
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=_-]+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('https://*.public.blob.vercel-storage.com');
  });

  it('buildCsp adds unsafe-eval only in development', () => {
    expect(buildCsp('abc', false)).not.toContain('unsafe-eval');
    expect(buildCsp('abc', true)).toContain("'unsafe-eval'");
    expect(Object.keys(SECURITY_HEADERS)).toHaveLength(6);
  });

  it('generates a request id and echoes a supplied one', async () => {
    const generated = await middleware(req('/'));
    expect(generated.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await middleware(req('/', { headers: { 'x-request-id': 'abc-123' } }));
    expect(echoed.headers.get('X-Request-Id')).toBe('abc-123');
    const rejected = await middleware(req('/', { headers: { 'x-request-id': 'bad id with spaces' } }));
    expect(rejected.headers.get('X-Request-Id')).not.toBe('bad id with spaces');
  });
});

describe('CSRF origin check on /api mutations', () => {
  const good = { origin: 'http://localhost:3000', 'x-requested-with': 'AvenueStock' };

  it('blocks a foreign Origin with a 403 envelope', async () => {
    const res = await middleware(req('/api/v1/auth/login', { method: 'POST', headers: { ...good, origin: 'https://evil.example' } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Cross-site request blocked' } });
  });

  it('blocks a missing X-Requested-With even with a correct Origin', async () => {
    const res = await middleware(req('/api/v1/auth/login', { method: 'POST', headers: { origin: 'http://localhost:3000' } }));
    expect(res.status).toBe(403);
  });

  it('blocks a mutation with neither Origin nor Referer', async () => {
    const res = await middleware(req('/api/v1/auth/login', { method: 'POST', headers: { 'x-requested-with': 'AvenueStock' } }));
    expect(res.status).toBe(403);
  });

  it('accepts a same-origin mutation with the custom header', async () => {
    const res = await middleware(req('/api/v1/auth/login', { method: 'POST', headers: good }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('accepts Referer as a fallback for Origin', async () => {
    const res = await middleware(
      req('/api/v1/auth/login', { method: 'POST', headers: { referer: 'http://localhost:3000/login', 'x-requested-with': 'AvenueStock' } }),
    );
    expect(res.status).toBe(200);
  });

  describe('Vercel deployment URLs', () => {
    const previewHost = 'avenue-stock-abc123-team.vercel.app';
    const fromPreview = { origin: `https://${previewHost}`, 'x-requested-with': 'AvenueStock' };
    afterEach(() => vi.unstubAllEnvs());

    it('accepts the deployment and branch URLs on a preview deployment', async () => {
      vi.stubEnv('VERCEL_ENV', 'preview');
      vi.stubEnv('VERCEL_URL', previewHost);
      vi.stubEnv('VERCEL_BRANCH_URL', 'avenue-stock-git-sprint-6-team.vercel.app');
      expect((await middleware(req('/api/v1/auth/login', { method: 'POST', headers: fromPreview }))).status).toBe(200);
      const branch = { ...fromPreview, origin: 'https://avenue-stock-git-sprint-6-team.vercel.app' };
      expect((await middleware(req('/api/v1/auth/login', { method: 'POST', headers: branch }))).status).toBe(200);
      expect((await middleware(req('/api/v1/auth/login', { method: 'POST', headers: { ...fromPreview, origin: 'https://evil.example' } }))).status).toBe(403);
    });

    it('accepts only APP_URL in production, even when VERCEL_URL is set', async () => {
      vi.stubEnv('VERCEL_ENV', 'production');
      vi.stubEnv('VERCEL_URL', previewHost);
      expect((await middleware(req('/api/v1/auth/login', { method: 'POST', headers: fromPreview }))).status).toBe(403);
    });
  });

  it('does not apply to GET requests or non-API paths', async () => {
    expect((await middleware(req('/api/v1/health', { headers: { origin: 'https://evil.example' } }))).status).toBe(200);
    expect((await middleware(req('/login', { method: 'POST', headers: { origin: 'https://evil.example' } }))).status).toBe(200);
  });
});
