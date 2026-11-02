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
];
