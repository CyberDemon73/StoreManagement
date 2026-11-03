import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { UNAUTHENTICATED_MESSAGE, type AuthOptions, type AuthedRouteHandler } from '@/lib/auth';
import { ROLES, can, type Permission } from '@/lib/permissions';
import { ROUTES, type RouteSpec } from '@/lib/route-manifest';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

const API_ROOT = join(process.cwd(), 'src/app/api/v1');
const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE'];
const HTTP_METHODS = [...ALLOWED_METHODS, 'PUT', 'HEAD', 'OPTIONS'];

function* routeFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* routeFiles(full);
    else if (entry === 'route.ts') yield full;
  }
}

function routePath(file: string): string {
  return (
    '/' +
    relative(API_ROOT, file)
      .split(/[\\/]/)
      .filter((seg) => seg !== 'route.ts')
      .map((seg) => seg.replace(/^\[(\w+)\]$/, ':$1'))
      .join('/')
  );
}

/**
 * Every exported HTTP method of every route.ts on disk, as "METHOD /path".
 * Uses a real import so `export async function GET` and `export { GET }` are seen too,
 * not just `export const GET`.
 */
async function discoverRoutes(): Promise<{ routes: string[]; disallowed: string[] }> {
  const routes: string[] = [];
  const disallowed: string[] = [];
  for (const file of routeFiles(API_ROOT)) {
    const path = routePath(file);
    const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
    for (const method of Object.keys(mod).filter((k) => HTTP_METHODS.includes(k))) {
      if (ALLOWED_METHODS.includes(method)) routes.push(`${method} ${path}`);
      else disallowed.push(`${method} ${path}`);
    }
  }
  return { routes: routes.sort(), disallowed: disallowed.sort() };
}

/** The withAuth options a manifest `access` value must correspond to. */
function expectedAuth(access: RouteSpec['access']): AuthOptions {
  if (access === 'public') return { public: true };
  if (access === 'auth') return { auth: true };
  return { permission: access };
}

/** 401 emitted by withAuth itself (missing session), as opposed to a route's own 401 (e.g. bad credentials). */
async function isAuthWrapper401(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  const body = (await res.clone().json()) as { error?: { message?: string } };
  return body.error?.message === UNAUTHENTICATED_MESSAGE;
}

async function expectNotBlocked(res: Response): Promise<void> {
  expect(res.status).not.toBe(403);
  expect(await isAuthWrapper401(res)).toBe(false);
}

describe('authz matrix', () => {
  let discovered: Awaited<ReturnType<typeof discoverRoutes>>;

  beforeAll(async () => {
    discovered = await discoverRoutes();
  });

  it('only exports GET/POST/PATCH/DELETE handlers', () => {
    expect(discovered.disallowed, `routes export unsupported HTTP methods (only GET/POST/PATCH/DELETE are allowed): ${discovered.disallowed.join(', ')}`).toEqual([]);
  });

  it('registers every route handler that exists on disk', () => {
    const registered = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(registered).toEqual(discovered.routes);
  });

  for (const route of ROUTES) {
    const label = `${route.method} ${route.path}`;

    it(`${label}: manifest access '${route.access}' matches the handler's withAuth options`, async () => {
      const handlers = await route.load();
      const handler = handlers[route.method];
      if (!handler) throw new Error(`no ${route.method} export for ${route.path}`);
      const actual = (handler as AuthedRouteHandler).auth;
      expect(actual, `${label}: handler is not wrapped in withAuth (no .auth options attached)`).toBeDefined();
      expect(actual, `${label}: manifest says access '${route.access}' but withAuth was called with ${JSON.stringify(actual)}`).toEqual(expectedAuth(route.access));
    });

    it(`${label}: anonymous → ${route.access === 'public' ? 'allowed' : '401'}`, async () => {
      const handlers = await route.load();
      const handler = handlers[route.method];
      if (!handler) throw new Error(`no ${route.method} export for ${route.path}`);
      const res = await call(handler, { method: route.method, path: `/api/v1${route.path}`, body: route.sampleBody, params: route.sampleParams });
      if (route.access === 'public') await expectNotBlocked(res);
      else expect(res.status).toBe(401);
    });

    for (const role of ROLES) {
      const allowed = route.access === 'public' || route.access === 'auth' || can({ role }, route.access as Permission);
      it(`${label}: ${role} → ${allowed ? 'not 401/403' : '403'}`, async () => {
        const db = getDb();
        const user = await createUser(db, { role });
        const cookie = await sessionCookieFor(db, user.id);
        const handlers = await route.load();
        const handler = handlers[route.method];
        if (!handler) throw new Error(`no ${route.method} export for ${route.path}`);
        const res = await call(handler, { method: route.method, path: `/api/v1${route.path}`, body: route.sampleBody, params: route.sampleParams, cookie });
        if (allowed) await expectNotBlocked(res);
        else expect(res.status).toBe(403);
      });
    }
  }
});
