import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, isCsrfSafe, isValidRequestId, SECURITY_HEADERS } from '@/lib/security-headers';

// Runs on the edge: keep this file free of Node-only modules (db, pino, argon2).

function appOrigin(): string {
  try {
    return new URL(process.env.APP_URL ?? 'http://localhost:3000').origin;
  } catch {
    return 'http://localhost:3000';
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export default function middleware(req: NextRequest): NextResponse {
  const incomingId = req.headers.get('x-request-id');
  const requestId = isValidRequestId(incomingId) ? incomingId : crypto.randomUUID();
  const nonce = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development');

  const applyHeaders = (res: NextResponse): NextResponse => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    res.headers.set('Content-Security-Policy', csp);
    res.headers.set('X-Request-Id', requestId);
    return res;
  };

  if (req.nextUrl.pathname.startsWith('/api/') && !isCsrfSafe(req, appOrigin())) {
    return applyHeaders(
      NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Cross-site request blocked' } }, { status: 403 }),
    );
  }

  // Forward nonce + id so server components and route handlers can read them.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('Content-Security-Policy', csp);

  return applyHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js).*)'],
};
