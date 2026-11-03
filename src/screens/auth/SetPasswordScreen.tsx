'use client';
/**
 * Screen: /set-password?invite=&email=&name=&role=&by= · Roles: public (invited user)
 * Calls: POST /auth/reset (invite token) → POST /auth/login → home.
 * Invite details come from the link; the API validates the token server-side.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth-context';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox, Field, Input } from '@/components/ui/Field';
import { RoleBadge } from '@/components/ui/Badge';
import type { Role } from '@/types';
import { PasswordField, passwordOk } from './PasswordField';

export function SetPasswordScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
  const invite = params.get('invite') ?? '';
  const email = params.get('email') ?? 'karim@avenue.eg';
  const name = params.get('name') ?? email.split('@')[0] ?? '';
  const by = params.get('by') ?? 'Your manager';
  const roleParam = params.get('role');
  const role: Role = roleParam === 'ADMIN' || roleParam === 'MANAGER' ? roleParam : 'SELLER';
  const [pw, setPw] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [invalid, setInvalid] = useState(!invite);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordOk(pw)) { setError('Use at least 12 characters that are not a common password.'); return; }
    if (!agree) { setError('Please accept the device & data policy.'); return; }
    setBusy(true); setError(undefined);
    try {
      await api.auth.reset(invite, pw);
      const user = await auth.login(email, pw, true);
      router.replace(homeFor(user.role));
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'NOT_FOUND' || err.code === 'VALIDATION')) setInvalid(true);
      else setError((err as Error).message);
    } finally { setBusy(false); }
  };

  if (invalid) {
    return (
      <Card role="alert" className="flex flex-col gap-3 p-6">
        <div><h2 className="text-lg font-semibold">This invite is no longer valid</h2><p className="mt-1 text-sm text-ink-2">Invite links are single-use and expire after 7 days. Ask {by} to send a new one.</p></div>
        <LinkButton href="/login" variant="primary" size="lg" block>Back to sign in</LinkButton>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Card as="section" aria-labelledby="inv-h" className="p-6">
        <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
          <div><h2 id="inv-h" className="text-lg font-semibold">Welcome{name ? `, ${name.split(' ')[0]}` : ''}</h2><p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-2">{by} invited you to Avenue Stock as a <RoleBadge role={role} /></p></div>
          <Field label="Email" htmlFor="i-email"><Input id="i-email" type="email" size="lg" value={email} readOnly autoComplete="username" wrapperClassName="bg-surface-2" /></Field>
          <PasswordField id="i-pw" label="Create a password" value={pw} onChange={setPw} placeholder="At least 12 characters" error={error} autoFocus />
          <Checkbox checked={agree} onChange={setAgree} label="I agree to the store's device & data policy" />
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!pw || !agree}>Create account</Button>
        </form>
      </Card>
      <p className="px-1 text-xs text-ink-2">Invite links are single-use and expire after 7 days. Sellers never see cost or profit anywhere in the app.</p>
    </div>
  );
}
