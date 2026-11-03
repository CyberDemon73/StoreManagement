'use client';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import type { Permission } from '@/types';
import { ForbiddenScreen } from '@/screens/system/SystemScreens';

/** Page guard: renders the 403 screen when the acting role lacks the permission. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const auth = useAuth();
  if (!auth.can(permission)) return <ForbiddenScreen permission={permission} />;
  return <>{children}</>;
}
