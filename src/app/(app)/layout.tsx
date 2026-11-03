'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useRequireSession } from '@/lib/auth-context';
import { homeFor } from '@/lib/landing';
import { permissionForPath } from '@/lib/nav';
import { AppShell } from '@/components/app/AppShell';
import { ForbiddenScreen } from '@/screens/system/SystemScreens';

/** Role home pages: opening the other role's home is a wrong turn, not a permission error. */
const HOME_ROUTES = new Set(['/dashboard', '/home']);

/**
 * Authenticated area. Redirects to /login without a session, wraps pages in the responsive
 * shell and applies the route → permission map from docs/ACCESS-MATRIX.md. The API enforces
 * the same permissions server-side; this guard is for the UI only.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = useRequireSession();
  const pathname = usePathname();
  const router = useRouter();
  const perm = permissionForPath(pathname);
  const denied = !!auth && !!perm && !auth.can(perm);
  const wrongHome = denied && HOME_ROUTES.has(pathname);

  useEffect(() => {
    if (wrongHome && auth) router.replace(homeFor(auth.role));
  }, [wrongHome, auth, router]);

  if (!auth || wrongHome) return <div className="flex min-h-dvh items-center justify-center text-sm text-ink-2" aria-busy="true">Loading…</div>;
  return <AppShell>{denied && perm ? <ForbiddenScreen permission={perm} /> : children}</AppShell>;
}
