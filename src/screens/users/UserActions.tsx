'use client';
/** Users · row actions: Edit role dialog, force reset, sign out everywhere, disable/enable (PATCH /users/:id, POST /users/:id/*). */
import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog, MenuItem, Popover } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import type { Role, User } from '@/types';
import { RoleRadioCards } from './CreateUserPanel';

type Action = 'role' | 'reset' | 'signout' | 'toggle' | 'delete';

export function UserActions({ user, onChange, onDeleted }: { user: User; onChange: (u: User) => void; onDeleted?: (id: string) => void }) {
  const auth = useAuth();
  const { toast } = useToast();
  const [resending, setResending] = useState(false);
  // For an INVITED user, an EMAIL reset issues a fresh 48 h invite link and voids the old one.
  const resendInvite = async () => {
    setResending(true);
    try {
      await api.users.resetPassword(user.id, 'EMAIL');
      toast({ kind: 'success', title: `Invite resent to ${user.email}`, body: 'The new link expires in 48 hours; the old one no longer works.' });
    } catch (e) {
      toast({ kind: 'error', title: "Couldn't resend the invite", body: (e as Error).message });
    } finally {
      setResending(false);
    }
  };
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<Action | null>(null);
  const [role, setRole] = useState<Role>(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const isSelf = auth.user?.id === user.id;
  const disabled = user.status === 'DISABLED';

  const run = async (fn: () => Promise<User | void>, done: string, inline = false) => {
    setBusy(true); setError(undefined);
    try {
      const u = await fn();
      if (u) onChange(u);
      toast({ kind: 'success', title: done });
      setDialog(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Something went wrong.';
      if (inline) setError(msg); else toast({ kind: 'error', title: "Couldn't complete that", body: msg });
    } finally { setBusy(false); }
  };

  const open = (a: Action) => { setMenu(false); setError(undefined); setRole(user.role); setDialog(a); };

  if (disabled) {
    return (
      <div className="flex justify-end">
        <Button size="sm" loading={busy} onClick={() => void run(() => api.users.setEnabled(user.id, true), `${user.name} enabled`)}>Enable</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {user.status === 'INVITED'
        ? <Button size="sm" loading={resending} onClick={() => void resendInvite()}>Resend invite</Button>
        : <Button size="sm" onClick={() => open('role')}>Edit</Button>}
      <Popover open={menu} onClose={() => setMenu(false)} anchor={<Button size="sm" variant="ghost" iconOnly aria-label={`More actions for ${user.name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><MoreHorizontal /></Button>}>
        <MenuItem onClick={() => open('role')}>Edit role</MenuItem>
        <MenuItem onClick={() => open('reset')}>Force password reset</MenuItem>
        <MenuItem onClick={() => open('signout')}>Sign out everywhere</MenuItem>
        <div className="my-1 h-px bg-line" />
        <MenuItem danger onClick={() => open('toggle')}>Disable user</MenuItem>
        {user.deletable && <MenuItem danger onClick={() => open('delete')}>Delete user</MenuItem>}
      </Popover>

      <Dialog open={dialog === 'role'} onClose={() => setDialog(null)} title={`Edit role · ${user.name}`} description="Takes effect at their next request. Recorded in the audit log."
        footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" loading={busy} disabled={role === user.role} onClick={() => void run(() => api.users.update(user.id, { role }), `${user.name} is now ${role.toLowerCase()}`, true)}>Save role</Button></>}>
        <RoleRadioCards value={role} onChange={setRole} name={`role-${user.id}`} />
        {isSelf && role !== 'ADMIN' && <p className="mt-3 text-xs text-warn-ink">You are changing your own role. You may lose access to this page.</p>}
        {error && <p role="alert" className="mt-3 text-xs text-danger-ink">{error}</p>}
      </Dialog>

      <ConfirmDialog open={dialog === 'reset'} onClose={() => setDialog(null)} pending={busy} title={`Force password reset for ${user.name}?`} description={`We email ${user.email} a reset link that works for 30 minutes. Their current password keeps working until they use it.`} confirmLabel="Send reset link"
        onConfirm={() => void run(async () => { await api.users.resetPassword(user.id, 'EMAIL'); }, `Reset link sent to ${user.email}`)} />

      <ConfirmDialog open={dialog === 'signout'} onClose={() => setDialog(null)} pending={busy} title={`Sign ${user.name} out everywhere?`} description={`${user.sessions ?? 0} active session${user.sessions === 1 ? '' : 's'} will end. They can sign in again straight away.`} confirmLabel="Sign out everywhere"
        onConfirm={() => void run(() => api.users.revokeSessions(user.id), `${user.name} signed out on every device`)} />

      <ConfirmDialog open={dialog === 'delete'} onClose={() => setDialog(null)} pending={busy} danger title={`Delete ${user.name}?`} description="This permanently removes the account. It is only possible because they have no sales or stock history. This cannot be undone." confirmLabel="Delete user"
        onConfirm={() => void run(async () => { await api.users.remove(user.id); onDeleted?.(user.id); }, `${user.name} deleted`, true)} />
      <ConfirmDialog open={dialog === 'toggle'} onClose={() => setDialog(null)} pending={busy} danger title={`Disable ${user.name}?`} description="They are signed out immediately and cannot sign in until re-enabled. Their sales history stays." confirmLabel="Disable user"
        onConfirm={() => void run(() => api.users.setEnabled(user.id, false), `${user.name} disabled`, true)}>
        {error && <p role="alert" className="rounded-input bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">{error}</p>}
      </ConfirmDialog>
    </div>
  );
}
