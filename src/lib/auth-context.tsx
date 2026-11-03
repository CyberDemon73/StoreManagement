'use client';
/**
 * Session + acting role for the UI. The server is the authority (GET /auth/me); this context
 * only mirrors it and adds two pure-UI concepts: "View as seller" and the role switcher for
 * users who hold more than one role. Permission checks here are for showing/hiding UI; the
 * API enforces them again.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Permission, Role, User } from '@/types';
import { PERMISSIONS } from '@/lib/permissions';
import { api, ApiError, isLive, setApiContext } from '@/lib/api';

interface Session { user: User; actingRole: Role; viewAsSeller: boolean }

interface AuthValue {
  user: User | null;
  /** Role the UI renders for: viewAsSeller → SELLER, else the chosen role. */
  role: Role;
  viewAsSeller: boolean;
  ready: boolean;
  can: (p: Permission) => boolean;
  isManager: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<User>;
  logout: () => Promise<void>;
  setViewAsSeller: (on: boolean) => void;
  switchRole: (role: Role) => void;
}

const KEY = 'avenue.session';
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let stored: Session | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) stored = JSON.parse(raw) as Session;
    } catch { /* ignore */ }
    if (!isLive('/auth/me')) { setSession(stored); setReady(true); return; }
    // The cookie session is the authority: confirm it with GET /auth/me and keep only the UI
    // state (acting role, view-as-seller) from this device.
    let cancelled = false;
    api.auth.me()
      .then((r) => {
        if (cancelled) return;
        if (!r) { setSession(null); return; }
        const acting = stored && stored.user.id === r.user.id && r.user.roles.includes(stored.actingRole) ? stored.actingRole : r.user.role;
        const next: Session = { user: r.user, actingRole: acting, viewAsSeller: stored?.user.id === r.user.id ? stored.viewAsSeller : false };
        setSession(next);
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Offline: trust the stored session so the cached catalogue stays usable.
        if (e instanceof ApiError && e.code === 'OFFLINE') setSession(stored);
        else { setSession(null); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
      })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback((s: Session | null) => {
    setSession(s);
    try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  }, []);

  const role: Role = session ? (session.viewAsSeller ? 'SELLER' : session.actingRole) : 'SELLER';
  useEffect(() => { setApiContext({ userId: session?.user.id ?? 'anon', role }); }, [session, role]);

  const value = useMemo<AuthValue>(() => ({
    user: session?.user ?? null,
    role,
    viewAsSeller: session?.viewAsSeller ?? false,
    ready,
    can: (p) => PERMISSIONS[role].has(p),
    isManager: role !== 'SELLER',
    login: async (email, password, remember) => {
      const { user } = await api.auth.login(email, password, remember);
      persist({ user, actingRole: user.role, viewAsSeller: false });
      return user;
    },
    logout: async () => { await api.auth.logout().catch(() => undefined); persist(null); router.replace('/login'); },
    setViewAsSeller: (on) => { if (session) persist({ ...session, viewAsSeller: on }); },
    switchRole: (r) => { if (session && session.user.roles.includes(r)) persist({ ...session, actingRole: r, viewAsSeller: false }); },
  }), [session, role, ready, persist, router]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** Home route for a role. */
export function homeFor(role: Role): string {
  return role === 'SELLER' ? '/home' : '/dashboard';
}

/** Redirects to /login when there is no session. Renders nothing until the session is read. */
export function useRequireSession(): AuthValue | null {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (auth.ready && !auth.user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [auth.ready, auth.user, router, pathname]);
  if (!auth.ready || !auth.user) return null;
  return auth;
}
