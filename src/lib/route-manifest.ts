import type { RouteHandler } from './auth';
import type { Permission } from './permissions';

export type RouteMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RouteSpec {
  method: RouteMethod;
  /** Path relative to /api/v1, with `:param` for dynamic segments. */
  path: string;
  /** 'public' (no session), 'auth' (any role), or the permission key from docs/ACCESS-MATRIX.md. */
  access: 'public' | 'auth' | Permission;
  load: () => Promise<Partial<Record<RouteMethod, RouteHandler>>>;
  /** Body that passes validation, so the authz test reaches the permission check. */
  sampleBody?: unknown;
  sampleParams?: Record<string, string>;
}

/**
 * Every API route, used by tests/authz/matrix.test.ts to assert the role matrix.
 * A route.ts on disk that is missing here fails that test.
 */
export const ROUTES: RouteSpec[] = [
  { method: 'GET', path: '/health', access: 'public', load: () => import('@/app/api/v1/health/route') },
  {
    method: 'POST',
    path: '/setup',
    access: 'public',
    load: () => import('@/app/api/v1/setup/route'),
    sampleBody: {
      name: 'Owner',
      email: 'owner@example.com',
      password: 'Zq9!vt-plume-orbit',
      storeName: 'Avenue',
      currency: 'EGP',
      setupToken: 'test-setup-token',
    },
  },
  {
    method: 'POST',
    path: '/auth/login',
    access: 'public',
    load: () => import('@/app/api/v1/auth/login/route'),
    sampleBody: { email: 'nobody@example.com', password: 'Zq9!vt-plume-orbit' },
  },
  { method: 'POST', path: '/auth/logout', access: 'auth', load: () => import('@/app/api/v1/auth/logout/route') },
  { method: 'GET', path: '/auth/me', access: 'auth', load: () => import('@/app/api/v1/auth/me/route') },
];
