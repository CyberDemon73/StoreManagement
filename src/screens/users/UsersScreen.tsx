'use client';
/**
 * Screen: /users · Roles: ADMIN, MANAGER (users.manage)
 * Calls: GET /users · POST /users · PATCH /users/:id · POST /users/:id/disable|enable ·
 * POST /users/:id/reset-password · POST /users/:id/revoke-sessions.
 */
import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useBreakpoint } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Avatar, Badge, Chip, RoleBadge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import type { Role, User, UserStatus } from '@/types';
import { CreateUserPanel } from './CreateUserPanel';
import { UserActions } from './UserActions';

const STATUS: Record<UserStatus, { label: string; tone: Tone }> = { ACTIVE: { label: 'Active', tone: 'ok' }, INVITED: { label: 'Invited · not accepted', tone: 'warn' }, DISABLED: { label: 'Disabled', tone: 'danger' } };
const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Admin', MANAGER: 'Manager', SELLER: 'Seller' };

function userNote(u: User, selfId: string | undefined): string {
  const others = u.roles.filter((r) => r !== u.role);
  const base = u.role === 'ADMIN' ? 'Owner' : ROLE_LABEL[u.role];
  const parts = [base, ...(others.length ? [`also ${others.map((r) => ROLE_LABEL[r]).join(', ')}`] : []), ...(u.id === selfId ? ['you'] : [])];
  return parts.join(' · ');
}

export function UsersScreen() {
  const auth = useAuth();
  const bp = useBreakpoint();
  const list = useApi(() => api.users.list(), []);
  const [roleFilter, setRoleFilter] = useState<Role | 'ALL'>('ALL');
  const [activeOnly, setActiveOnly] = useState(false);
  const [create, setCreate] = useState(false);

  const replace = (u: User) => list.setData((prev) => prev?.map((x) => (x.id === u.id ? { ...x, ...u } : x)));
  const removeRow = (id: string) => list.setData((prev) => prev?.filter((x) => x.id !== id));
  const rows = list.data?.filter((u) => (roleFilter === 'ALL' || u.roles.includes(roleFilter)) && (!activeOnly || u.status === 'ACTIVE'));

  const columns: Column<User>[] = [
    { key: 'user', header: 'User', cell: (u) => <span className="flex items-center gap-2.5"><Avatar name={u.name} /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{u.name}</span><span className="block text-xs text-ink-2">{userNote(u, auth.user?.id)}</span></span></span> },
    { key: 'email', header: 'Email', cell: (u) => <span className="text-ink-2">{u.email}</span> },
    { key: 'role', header: 'Role', cell: (u) => <span className="flex flex-wrap gap-1">{u.roles.map((r) => <RoleBadge key={r} role={r} />)}</span> },
    { key: 'status', header: 'Status', cell: (u) => <Badge tone={STATUS[u.status].tone} dot>{STATUS[u.status].label}</Badge> },
    { key: 'login', header: 'Last login', cell: (u) => <span className="tabular text-ink-2">{u.lastLoginAt ? `${formatDateTime(u.lastLoginAt)}${u.lastDevice ? ` · ${u.lastDevice.split(' · ')[0]}` : ''}` : '—'}</span> },
    { key: 'sessions', header: 'Sessions', cell: (u) => <span className="tabular">{u.status === 'INVITED' ? '—' : `${u.sessions ?? 0} device${u.sessions === 1 ? '' : 's'}`}</span> },
    { key: 'actions', header: <span className="block text-right">Actions</span>, cell: (u) => <UserActions user={u} onChange={replace} onDeleted={removeRow} /> },
  ];

  const filters = (
    <div className="scrollbar-none flex gap-1.5 overflow-x-auto" role="group" aria-label="Filter users">
      {(['ALL', 'ADMIN', 'MANAGER', 'SELLER'] as const).map((r) => <Chip key={r} selected={roleFilter === r} onClick={() => setRoleFilter(r)} size={bp === 'mobile' ? 'touch' : 'md'}>{r === 'ALL' ? 'All roles' : ROLE_LABEL[r]}</Chip>)}
      <Chip selected={activeOnly} onClick={() => setActiveOnly((a) => !a)} size={bp === 'mobile' ? 'touch' : 'md'}>{activeOnly ? 'Status: Active' : 'Status'}</Chip>
    </div>
  );

  const empty = <EmptyState icon={<Users aria-hidden />} title={list.data?.length ? 'No users match' : 'No users yet'} body={list.data?.length ? `Try clearing “${roleFilter === 'ALL' ? 'Status: Active' : ROLE_LABEL[roleFilter]}”.` : 'Create the first account for your team.'} action={list.data?.length ? <Button onClick={() => { setRoleFilter('ALL'); setActiveOnly(false); }}>Clear filters</Button> : <Button variant="primary" onClick={() => setCreate(true)}>Create user</Button>} />;

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">Users{list.data && <Badge>{list.data.length}</Badge>}</span>} compactTitle="Users" actions={<Button variant="primary" leading={<Plus />} onClick={() => setCreate(true)}>Create user</Button>} />
      <Page>
        {filters}
        {bp === 'mobile' ? (
          list.error && !list.data ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !rows ? <SkeletonRows rows={5} /> : rows.length === 0 ? empty : (
            <ul className="flex flex-col gap-2.5">
              {rows.map((u) => (
                <Card key={u.id} as="article" className={cn('flex flex-col gap-3', u.status === 'DISABLED' && 'opacity-60')}>
                  <div className="flex items-start gap-3"><Avatar name={u.name} size="lg" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{u.name}</p><p className="truncate text-xs text-ink-2">{u.email} · {userNote(u, auth.user?.id)}</p><div className="mt-1.5 flex flex-wrap gap-1">{u.roles.map((r) => <RoleBadge key={r} role={r} />)}<Badge tone={STATUS[u.status].tone} dot>{STATUS[u.status].label}</Badge></div></div></div>
                  <p className="tabular text-xs text-ink-2">{u.lastLoginAt ? `Last login ${formatDateTime(u.lastLoginAt)}${u.lastDevice ? ` · ${u.lastDevice}` : ''}` : 'Never signed in'} · {u.sessions ?? 0} device{u.sessions === 1 ? '' : 's'}</p>
                  <UserActions user={u} onChange={replace} onDeleted={removeRow} />
                </Card>
              ))}
            </ul>
          )
        ) : (
          <DataTable aria-label="Users" columns={columns} rows={rows} rowKey={(u) => u.id} loading={list.loading} error={list.error} onRetry={() => void list.refetch()} empty={empty}
            rowClassName={(u) => (u.status === 'DISABLED' ? 'opacity-60' : undefined)}
            footer={rows ? <span className="text-ink-2">{rows.length} of {list.data?.length ?? 0} users</span> : undefined} />
        )}
      </Page>
      <CreateUserPanel open={create} onClose={() => setCreate(false)} onCreated={() => void list.refetch()} />
    </>
  );
}
