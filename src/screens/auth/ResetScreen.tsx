'use client';
/**
 * Screen: /reset?token= · Roles: public
 * Calls: POST /auth/reset. `?token=expired` (or a missing token) renders the expired state.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { PasswordField, passwordOk } from './PasswordField';

export function ResetScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const token = params.get('token') ?? '';
  const email = params.get('email') ?? undefined;
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [expired, setExpired] = useState(!token || token === 'expired');
  const mismatch = pw2.length > 0 && pw !== pw2;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordOk(pw)) { setError('Use at least 12 characters that are not a common password.'); return; }
    if (pw !== pw2) return;
    setBusy(true); setError(undefined);
    try {
      await api.auth.reset(token, pw);
      toast({ kind: 'success', title: 'Password updated', body: 'Sign in with your new password.' });
      router.replace(email ? `/login?email=${encodeURIComponent(email)}` : '/login');
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'NOT_FOUND' || err.code === 'VALIDATION')) setExpired(true);
      else setError((err as Error).message);
    } finally { setBusy(false); }
  };

  if (expired) {
    return (
      <Card role="alert" className="flex items-start gap-3 p-5">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <div className="flex flex-col gap-3"><div><p className="text-sm font-semibold">This link has expired</p><p className="mt-0.5 text-xs text-ink-2">Reset links work for 30 minutes and can only be used once.</p></div><div className="flex gap-2"><LinkButton size="sm" variant="primary" href="/forgot">Request a new one</LinkButton><LinkButton size="sm" href="/login">Back to sign in</LinkButton></div></div>
      </Card>
    );
  }

  return (
    <Card as="section" aria-labelledby="reset-h" className="p-6">
      <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
        <div><h2 id="reset-h" className="text-lg font-semibold">Choose a new password</h2>{email && <p className="mt-1 text-sm text-ink-2">For {email}</p>}</div>
        {email && <Input type="email" value={email} readOnly autoComplete="username" className="sr-only" aria-hidden tabIndex={-1} />}
        <PasswordField id="r-pw" label="New password" value={pw} onChange={setPw} error={error} autoFocus />
        <Field label="Confirm password" htmlFor="r-pw2" error={mismatch ? "Passwords don't match." : undefined}>
          <Input id="r-pw2" type="password" size="lg" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} invalid={mismatch} required />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!pw || !pw2 || mismatch}>Set password & sign in</Button>
        <Link href="/login" className="text-center text-sm text-accent">Back to sign in</Link>
      </form>
    </Card>
  );
}
