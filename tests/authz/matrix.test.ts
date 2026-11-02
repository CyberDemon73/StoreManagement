import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { ROLES, can, type Permission } from '@/lib/permissions';
import { ROUTES } from '@/lib/route-manifest';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

const API_ROOT = join(process.cwd(), 'src/app/api/v1');

function* routeFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* routeFiles(full);
    else if (entry === 'route.ts') yield full;
  }
}

/** Every exported HTTP method of every route.ts, as "METHOD /path". */
function discoveredRoutes(): string[] {
  const out: string[] = [];
  for (const file of routeFiles(API_ROOT)) {
    const src = readFileSync(file, 'utf8');
    const path =
      '/' +
      relative(API_ROOT, file)
        .split(/[\\/]/)
        .filter((seg) => seg !== 'route.ts')
        .map((seg) => seg.replace(/^\[(\w+)\]$/, ':$1'))
        .join('/');
    for (const m of src.matchAll(/export const (GET|POST|PATCH|DELETE)\b/g)) out.push(`${m[1]} ${path}`);
  }
  return out.sort();
}

describe('authz matrix', () => {
  it('registers every route handler that exists on disk', () => {
    const registered = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(registered).toEqual(discoveredRoutes());
  });

  for (const route of ROUTES) {
    const label = `${route.method} ${route.path}`;

    it(`${label}: anonymous → ${route.access === 'public' ? 'allowed' : '401'}`, async () => {
      const handlers = await route.load();
      const handler = handlers[route.method];
      if (!handler) throw new Error(`no ${route.method} export for ${route.path}`);
      const res = await call(handler, { method: route.method, path: `/api/v1${route.path}`, body: route.sampleBody, params: route.sampleParams });
      if (route.access === 'public') expect([401, 403]).not.toContain(res.status);
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
        if (allowed) expect([401, 403]).not.toContain(res.status);
        else expect(res.status).toBe(403);
      });
    }
  }
});
