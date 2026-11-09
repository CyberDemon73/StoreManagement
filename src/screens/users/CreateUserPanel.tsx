'use client';
/** Users · Create user panel (POST /users). Sheet on mobile, Drawer on larger screens. */
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Field, Input, Segmented } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import type { Role, User } from '@/types';

export const ROLE_OPTIONS: { role: Role; label: string; description: string }[] = [
  { role: 'SELLER', label: 'Seller', description: 'Sell, see products & own sales. No cost, profit, analytics or settings.' },
  { role: 'MANAGER', label: 'Manager', description: 'Everything an admin can do, for now.' },
  { role: 'ADMIN', label: 'Admin', description: 'Full access including users and security settings.' },
];

export function RoleRadioCards({ value, onChange, name = 'role' }: { value: Role; onChange: (r: Role) => void; name?: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-[13px] font-medium">Role</legend>
      {ROLE_OPTIONS.map((o) => (
        <label key={o.role} className={cn('flex cursor-pointer items-start gap-3 rounded-card border p-3 transition-colors', value === o.role ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}>
          <input type="radio" name={name} value={o.role} checked={value === o.role} onChange={() => onChange(o.role)} className="mt-0.5 size-[18px] accent-[var(--accent)]" />
          <span><span className="block text-sm font-semibold">{o.label}</span><span className="block text-xs text-ink-2">{o.description}</span></span>
        </label>
      ))}
    </fieldset>
  );
}

export function CreateUserPanel({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (u: User) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('SELLER');
  const [mode, setMode] = useState<'INVITE' | 'TEMP'>('INVITE');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // The server generates the temporary password and returns it once; keep the panel open on it
  // until the admin has copied it down.
  const [created, setCreated] = useState<{ name: string; password: string }>();

  const reset = () => { setName(''); setEmail(''); setRole('SELLER'); setMode('INVITE'); setErrors({}); setCreated(undefined); };
  const close = () => { reset(); onClose(); };
  const copy = (pw: string) => { void navigator.clipboard?.writeText(pw).then(() => toast({ kind: 'info', title: 'Temporary password copied' })).catch(() => undefined); };

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Full name is required.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errs.email = 'Enter a valid email address.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const { user: u, temporaryPassword } = await api.users.create({ name: name.trim(), email: email.trim(), role, mode });
      onCreated(u);
      if (mode === 'TEMP' && temporaryPassword) {
        setCreated({ name: u.name, password: temporaryPassword });
        return;
      }
      toast({ kind: 'success', title: mode === 'INVITE' ? `Invite sent to ${u.email}` : `${u.name} created`, body: mode === 'INVITE' ? 'The link expires in 48 hours.' : undefined });
      close();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields ?? { form: err.message }); else setErrors({ form: 'Something went wrong.' });
    } finally { setBusy(false); }
  };

  if (created) {
    return (
      <Panel open={open} onClose={close} title={`${created.name} created`} description="Give them this temporary password. It is shown only once."
        footer={<div className="flex gap-2"><Button size="lg" variant="primary" className="flex-1" onClick={close}>Done</Button></div>}>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-input border border-line bg-surface-2 px-3 py-2">
            <span className="tabular flex-1 select-all break-all font-mono text-sm" aria-label="Temporary password">{created.password}</span>
            <Button size="sm" variant="ghost" leading={<Copy />} onClick={() => copy(created.password)} data-autofocus>Copy</Button>
          </div>
          <p className="text-xs text-ink-2">They sign in with it and must choose their own password straight away.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel open={open} onClose={close} title="Create user" description="They will appear in the list straight away."
      footer={<div className="flex gap-2"><Button size="lg" variant="primary" className="flex-1" loading={busy} onClick={() => void submit()}>{mode === 'INVITE' ? 'Create & send invite' : 'Create user'}</Button><Button size="lg" onClick={close}>Cancel</Button></div>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        {errors.form && <p role="alert" className="rounded-input bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger-ink">{errors.form}</p>}
        <Field label="Full name" htmlFor="u-name" error={errors.name}><Input id="u-name" size="lg" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} data-autofocus /></Field>
        <Field label="Email" htmlFor="u-email" error={errors.email}><Input id="u-email" type="email" size="lg" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} /></Field>
        <RoleRadioCards value={role} onChange={setRole} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">First sign-in</legend>
          <Segmented size="lg" grow value={mode} onChange={setMode} aria-label="First sign-in" options={[{ value: 'INVITE', label: 'Send invite link' }, { value: 'TEMP', label: 'Set temporary password' }]} />
          <p className="text-xs text-ink-2">{mode === 'INVITE' ? 'Invite expires in 48 hours. They choose their own password.' : 'A temporary password is generated and shown after you create the user. They must change it at first sign-in.'}</p>
        </fieldset>
        <button type="submit" className="sr-only">Create</button>
      </form>
    </Panel>
  );
}
