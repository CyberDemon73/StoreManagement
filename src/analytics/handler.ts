import type { ZodType } from 'zod';
import { withAuth, type AuthedRouteHandler } from '@/lib/auth';
import { memo } from '@/lib/cache';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import type { Db } from '@/db/client';

/**
 * Standard analytics GET route: `analytics.read`, strict query schema, memoised result,
 * `Cache-Control: private, no-store`: tills are shared, so the browser must not keep a manager's
 * report after logout; speed comes from the server-side Upstash memo instead.
 */
export function analyticsRoute<Q extends Record<string, unknown>, R>(
  report: string,
  query: ZodType<Q>,
  run: (db: Db, q: Q) => Promise<R>,
): AuthedRouteHandler {
  return withAuth({ permission: 'analytics.read' }, async (req, { db }) => {
    const q = await parse(query, new URL(req.url).searchParams);
    const key = `${report}:${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()}`;
    const body = await memo(key, () => run(db, q));
    const res = json(body);
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  });
}
