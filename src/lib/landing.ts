import { permissionForPath } from '@/lib/nav';
import { PERMISSIONS } from '@/lib/permissions';
import type { Role } from '@/types';

/** Home route for a role. */
export function homeFor(role: Role): string {
  return role === 'SELLER' ? '/home' : '/dashboard';
}

const AUTH_PAGES = /^\/(login|forgot|reset|setup|accept-invite|set-password|session-expired)(\/|\?|$)/;

/**
 * Where to go after login or when opening `/`: the `next` path if it is an internal page this
 * role may open, otherwise the role's home. Stops a seller who was bounced from /dashboard
 * (or opened the PWA at /) from landing on a 403, and stops `next` from leaving the site.
 */
export function landingFor(role: Role, next: string | null | undefined): string {
  if (!next || next === '/' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return homeFor(role);
  if (AUTH_PAGES.test(next)) return homeFor(role);
  const perm = permissionForPath(next.split(/[?#]/)[0] ?? next);
  if (perm && !PERMISSIONS[role].has(perm)) return homeFor(role);
  return next;
}
