import type { Role } from '@/lib/permissions';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserLike {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  mustChangePassword: boolean;
  lastLoginAt?: Date | null;
  createdAt?: Date;
}

/** Public shape of a user. Never includes passwordHash. */
export function toPublicUser(u: UserLike): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: (u.createdAt ?? new Date(0)).toISOString(),
  };
}
