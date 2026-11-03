import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { sessions, settings, users } from '@/db/schema';
import { AppError } from './errors';
import { errorResponse, getClientIp, getUserAgent } from './http';
import { can, type Permission, type Role } from './permissions';
import { bumpAnalyticsVersion } from './cache';
import { apiUserLimiter, enforce } from './ratelimit';

export const SESSION_COOKIE = '__Host-as_session';
const IDLE_TOUCH_INTERVAL_MS = 5 * 60_000;
const DEFAULT_IDLE_HOURS = 12;
const DEFAULT_ABSOLUTE_DAYS = 30;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED' | 'INVITED';
  mustChangePassword: boolean;
  sessionId: string;
}

export interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

export interface HandlerCtx {
  user: AuthUser | null;
  params: Record<string, string>;
  req: ReqCtx;
  db: Db;
}

export interface RouteContext {
  params: Promise<Record<string, string>>;
}

export type RouteHandler = (req: Request, ctx: RouteContext) => Promise<Response>;

export type AuthOptions = { permission: Permission } | { auth: true } | { public: true };

/** A RouteHandler produced by withAuth, carrying its options so tests can introspect them. */
export interface AuthedRouteHandler extends RouteHandler {
  readonly auth: AuthOptions;
}

/** Message of the 401 withAuth emits for a missing session; tests use it to tell that 401 from a route's own. */
export const UNAUTHENTICATED_MESSAGE = 'Authentication required';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface NewSession {
  raw: string;
  expiresAt: Date;
  remember: boolean;
}

export async function createSession(
  db: Db,
  input: { userId: string; ip: string | null; userAgent: string | null; remember: boolean },
): Promise<NewSession> {
  const [cfg] = await db
    .select({ idle: settings.sessionIdleHours, absolute: settings.sessionAbsoluteDays })
    .from(settings)
    .limit(1);
  const now = Date.now();
  const idleExpiresAt = new Date(now + (cfg?.idle ?? DEFAULT_IDLE_HOURS) * 3_600_000);
  const expiresAt = new Date(now + (cfg?.absolute ?? DEFAULT_ABSOLUTE_DAYS) * 86_400_000);
  const raw = generateToken();
  await db.insert(sessions).values({
    id: hashToken(raw),
    userId: input.userId,
    ip: input.ip,
    userAgent: input.userAgent,
    expiresAt,
    idleExpiresAt,
  });
  return { raw, expiresAt, remember: input.remember };
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=') || null;
  }
  return null;
}

/** Resolve the session cookie to an active user, sliding the idle expiry at most once per 5 minutes. */
export async function getSessionUser(db: Db, req: Request): Promise<AuthUser | null> {
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw || raw.length > 128) return null;
  const id = hashToken(raw);
  const now = new Date();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now), gt(sessions.idleExpiresAt, now)))
    .limit(1);
  if (!row || row.user.status !== 'ACTIVE') return null;

  if (now.getTime() - row.session.lastSeenAt.getTime() > IDLE_TOUCH_INTERVAL_MS) {
    const [cfg] = await db.select({ idle: settings.sessionIdleHours }).from(settings).limit(1);
    await db
      .update(sessions)
      .set({ lastSeenAt: now, idleExpiresAt: new Date(now.getTime() + (cfg?.idle ?? DEFAULT_IDLE_HOURS) * 3_600_000) })
      .where(eq(sessions.id, id));
  }

  return {
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    role: row.user.role,
    status: row.user.status,
    mustChangePassword: row.user.mustChangePassword,
    sessionId: id,
  };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export function sessionCookieHeader(raw: string, opts: { remember: boolean; expiresAt: Date }): string {
  let cookie = `${SESSION_COOKIE}=${raw}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  if (opts.remember) {
    const maxAge = Math.max(0, Math.floor((opts.expiresAt.getTime() - Date.now()) / 1000));
    cookie += `; Max-Age=${maxAge}`;
  }
  return cookie;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function requirePermission(user: AuthUser, permission: Permission): void {
  if (!can(user, permission)) throw new AppError('FORBIDDEN', 'You do not have permission to do this');
}

function requestId(req: Request): string {
  const incoming = req.headers.get('x-request-id');
  if (incoming && /^[A-Za-z0-9-]{1,64}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

const MUST_CHANGE_ALLOWED = new Set(['/api/v1/auth/me', '/api/v1/auth/logout', '/api/v1/me/password']);

function isAuthPath(req: Request): boolean {
  const path = new URL(req.url).pathname;
  return path.startsWith('/api/v1/auth/') || path === '/api/v1/setup';
}

/**
 * Wrap a route handler: resolve the session, enforce the permission, apply the per-user
 * rate limit, and turn every thrown error into the uniform envelope.
 */
export function withAuth(opts: AuthOptions, handler: (req: Request, ctx: HandlerCtx) => Promise<Response>): AuthedRouteHandler {
  const fn: RouteHandler = async (req, routeCtx) => {
    const id = requestId(req);
    try {
      const db = getDb();
      const user = await getSessionUser(db, req);
      if (!('public' in opts)) {
        if (!user) throw new AppError('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE);
        // Rate-limit before the permission check so a session hammering routes it is not
        // allowed to call (403s) burns its quota just like allowed traffic does.
        await enforce(apiUserLimiter, user.id);
        // A temporary or admin-reset password must be replaced before anything else is allowed.
        if (user.mustChangePassword && !MUST_CHANGE_ALLOWED.has(new URL(req.url).pathname)) {
          throw new AppError('FORBIDDEN', 'Change your password to continue', { fields: { password: 'Password change required' } });
        }
        if ('permission' in opts) requirePermission(user, opts.permission);
      }
      const params = await routeCtx.params;
      const res = await handler(req, {
        user,
        params,
        db,
        req: { ip: getClientIp(req), userAgent: getUserAgent(req), requestId: id },
      });
      res.headers.set('X-Request-Id', id);
      // Any committed business mutation can change a report: invalidate cached analytics.
      if (req.method !== 'GET' && res.status < 400 && !isAuthPath(req)) await bumpAnalyticsVersion();
      return res;
    } catch (err) {
      return errorResponse(err, id);
    }
  };
  // Non-enumerable so the options never leak into anything that spreads or serializes the handler.
  Object.defineProperty(fn, 'auth', { value: opts, enumerable: false });
  return fn as AuthedRouteHandler;
}
