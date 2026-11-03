'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { homeFor } from '@/lib/landing';

/**
 * `/` (also the PWA start_url): sellers land on /home, managers and admins on /dashboard,
 * signed-out visitors on /login.
 */
export default function Root() {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!auth.ready) return;
    router.replace(auth.user ? homeFor(auth.role) : '/login');
  }, [auth.ready, auth.user, auth.role, router]);
  return <div className="flex min-h-dvh items-center justify-center text-sm text-ink-2" aria-busy="true">Loading…</div>;
}
