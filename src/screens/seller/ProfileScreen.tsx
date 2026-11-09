'use client';
/**
 * Screen: /profile · Roles: all
 * Calls: POST /me/password · POST /auth/logout. Role switch is pure UI (auth.switchRole) for users
 * holding more than one role; theme is per device (useTheme).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth-context';
import { useTheme, type Theme } from '@/lib/theme-context';
import { cn } from '@/lib/cn';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, RoleBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Field, Input, Segmented } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import type { Role } from '@/types';

const APP_VERSION = 'v1.4.2';
const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Admin', MANAGER: 'Manager', SELLER: 'Seller' };

export function ProfileScreen() {
  const auth = useAuth();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [pwOpen, setPwOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const user = auth.user;
  if (!user) return null;

  const switchTo = (r: Role) => {
    auth.switchRole(r);
    router.push(homeFor(r));
  };

  const rowCls = 'flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm';

  return (
    <>
      <PageHeader title="Profile" />
      <Page className="max-w-[640px] gap-3.5">
        <Card className="flex items-center gap-3.5 p-4 md:p-4">
          <Avatar name={user.name} size="xl" tone="info" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold">{user.name}</p>
            <p className="truncate text-sm text-ink-2">{user.email}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {user.roles.map((r) => (r === auth.role ? <RoleBadge key={r} role={r} suffix="acting" /> : <RoleBadge key={r} role={r} />))}
              {auth.viewAsSeller && <Badge tone="warn">Viewing as seller</Badge>}
            </div>
          </div>
        </Card>

        {user.roles.length > 1 && (
          <Card padded={false} as="section" aria-labelledby="pr-role" className="overflow-hidden">
            <p id="pr-role" className="eyebrow px-4 pb-1 pt-3.5">Acting as</p>
            {user.roles.map((r) => {
              const active = r === auth.role && !auth.viewAsSeller;
              return (
                <button key={r} type="button" aria-pressed={active} onClick={() => !active && switchTo(r)} className={cn(rowCls, 'border-t border-line', active ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2')}>
                  <span className="flex-1 font-medium">{ROLE_LABEL[r]}</span>
                  {active ? <Check className="size-4" strokeWidth={2.5} aria-hidden /> : <Badge>Switch</Badge>}
                </button>
              );
            })}
            <p className="px-4 pb-3 pt-1.5 text-xs text-ink-2">Switching reloads the app with that role&apos;s navigation.</p>
          </Card>
        )}

        <Card padded={false} as="section" aria-labelledby="pr-acc" className="overflow-hidden">
          <p id="pr-acc" className="eyebrow px-4 pb-1 pt-3.5">Account</p>
          <button type="button" onClick={() => setPwOpen(true)} className={cn(rowCls, 'border-t border-line hover:bg-surface-2')}><span className="flex-1">Change password</span><ChevronRight className="size-4 text-ink-3" aria-hidden /></button>
          <div className={cn(rowCls, 'border-t border-line')}>
            <span className="flex-1" id="pr-theme">Theme</span>
            <Segmented size="sm" aria-label="Theme" value={theme} onChange={(t: Theme) => setTheme(t)} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Auto' }]} />
          </div>
          <div className={cn(rowCls, 'border-t border-line')}>
            <span className="flex-1">Devices · {user.sessions ?? 1} signed in</span>
            {user.lastDevice && <span className="truncate text-xs text-ink-2">{user.lastDevice}</span>}
          </div>
        </Card>

        <Card padded={false} as="section" aria-labelledby="pr-app" className="overflow-hidden">
          <p id="pr-app" className="eyebrow px-4 pb-1 pt-3.5">App</p>
          <div className={cn(rowCls, 'border-t border-line')}><span className="flex-1">Installed · {APP_VERSION}</span><Badge tone="ok">Up to date</Badge></div>
          <a href="/offline" className={cn(rowCls, 'border-t border-line hover:bg-surface-2')}><span className="flex-1">Offline catalogue</span><ChevronRight className="size-4 text-ink-3" aria-hidden /></a>
        </Card>

        <Button variant="dangerSoft" size="lg" block loading={signingOut} onClick={() => { setSigningOut(true); void auth.logout().finally(() => setSigningOut(false)); }}>Sign out</Button>
      </Page>

      <ChangePasswordPanel open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

function strength(pw: string): { score: number; label: string; tone: 'danger' | 'warn' | 'accent' | 'ok' } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const score = Math.min(4, pw.length === 0 ? 0 : Math.max(1, s - 1));
  const meta = [{ label: '', tone: 'danger' }, { label: 'Weak', tone: 'danger' }, { label: 'Fair', tone: 'warn' }, { label: 'Good', tone: 'accent' }, { label: 'Strong', tone: 'ok' }] as const;
  const m = meta[score] ?? meta[0];
  return { score, label: m.label, tone: m.tone };
}

/**
 * `required`: the account holds a temporary or admin-reset password, so the server refuses every
 * other call until it is replaced. Dismissing then means signing out (onClose), not carrying on.
 */
export function ChangePasswordPanel({ open, onClose, required, onChanged }: { open: boolean; onClose: () => void; required?: boolean; onChanged?: () => void }) {
  const { toast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const st = strength(next);
  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < 8;
  const canSubmit = current.length > 0 && next.length >= 8 && confirm === next && !busy;

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); setError(undefined); setShow(false); };
  const close = () => { reset(); onClose(); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError(undefined);
    try {
      await api.auth.changePassword(current, next);
      toast({ kind: 'success', title: 'Password changed', body: 'Use the new password next time you sign in.' });
      reset();
      if (onChanged) onChanged(); else onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('INTERNAL', (err as Error).message, 500));
    } finally { setBusy(false); }
  };

  const barTone = { danger: 'bg-danger', warn: 'bg-warn', accent: 'bg-accent', ok: 'bg-ok' }[st.tone];
  const type = show ? 'text' : 'password';
  const eye = <button type="button" aria-label={show ? 'Hide passwords' : 'Show passwords'} onClick={() => setShow((s) => !s)} className="rounded p-1 hover:bg-surface-2">{show ? <EyeOff /> : <Eye />}</button>;

  return (
    <Panel open={open} onClose={close} title={required ? 'Choose a new password' : 'Change password'}
      description={required ? 'You signed in with a temporary password. Enter it as the current password, then choose your own (at least 8 characters).' : 'At least 8 characters. Avoid names and common words.'}
      footer={<div className="flex justify-end gap-2 pb-1"><Button onClick={close}>{required ? 'Sign out' : 'Cancel'}</Button><Button variant="primary" type="submit" form="pw-form" loading={busy} disabled={!canSubmit}>Save password</Button></div>}>
      <form id="pw-form" className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {error && <p role="alert" className="rounded-input bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger-ink">{error.code === 'UNAUTHENTICATED' || error.code === 'VALIDATION' ? error.message : `Couldn't change the password. ${error.message}`}</p>}
        <Field label={required ? 'Temporary password' : 'Current password'} htmlFor="pw-current" error={error?.fields?.current}>
          <Input id="pw-current" type={type} size="lg" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} invalid={!!error?.fields?.current} data-autofocus trailing={eye} />
        </Field>
        <Field label="New password" htmlFor="pw-next" error={tooShort ? 'Use at least 8 characters.' : error?.fields?.next} help={!tooShort && next ? st.label : undefined}>
          <Input id="pw-next" type={type} size="lg" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} invalid={tooShort || !!error?.fields?.next} />
          <div className="mt-1 grid grid-cols-4 gap-1" aria-hidden>{Array.from({ length: 4 }).map((_, i) => <span key={i} className={cn('h-1 rounded-full', i < st.score ? barTone : 'bg-surface-2')} />)}</div>
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" error={mismatch ? 'Passwords do not match.' : undefined}>
          <Input id="pw-confirm" type={type} size="lg" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={mismatch} />
        </Field>
      </form>
    </Panel>
  );
}
