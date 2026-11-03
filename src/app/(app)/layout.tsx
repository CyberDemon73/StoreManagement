'use client';
import { usePathname } from 'next/navigation';
import { useRequireSession } from '@/lib/auth-context';
import { permissionForPath } from '@/lib/nav';
import { AppShell } from '@/components/app/AppShell';
import { ForbiddenScreen } from '@/screens/system/SystemScreens';

/**
 * Authenticated area. Redirects to /login without a session, wraps pages in the responsive
 * shell and applies the route → permission map from docs/ACCESS-MATRIX.md. The API enforces
 * the same permissions server-side; this guard is for the UI only.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = useRequireSession();
  const pathname = usePathname();
  if (!auth) return <div className="flex min-h-dvh items-center justify-center text-sm text-ink-2" aria-busy="true">Loading…</div>;
  const perm = permissionForPath(pathname);
  return <AppShell>{perm && !auth.can(perm) ? <ForbiddenScreen permission={perm} /> : children}</AppShell>;
}
