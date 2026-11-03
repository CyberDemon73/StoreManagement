'use client';
/**
 * Screen: /set-password?token= · Roles: public (invited user)
 * Calls: POST /auth/accept-invite { token, password } → 200 { user } + session cookie → home.
 * The invite email links here with `token`; older links used `invite`, which is still accepted.
 */
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { homeFor } from '@/lib/landing';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Field';
import { PasswordField, passwordOk } from './PasswordField';

export function SetPasswordScreen() {
  const params = useSearchParams();
  const token = params.get('token') ?? params.get('invite') ?? '';
  const [pw, setPw] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [invalid, setInvalid] = useState(!token);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordOk(pw)) { setError('Use at least 12 characters that are not a common password.'); return; }
    if (!agree) { setError('Please accept the device & data policy.'); return; }
    setBusy(true); setError(undefined);
    try {
      const { user } = await api.auth.acceptInvite(token, pw);
      // The response set the session cookie; a full load lets the app read the new session.
      window.location.replace(homeFor(user.role));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION' && /token|invit/i.test(err.message)) setInvalid(true);
      else setError(err instanceof ApiError && err.fields?.password ? err.fields.password : (err as Error).message);
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <Card role="alert" className="flex flex-col gap-3 p-6">
        <div><h2 className="text-lg font-semibold">This invite is no longer valid</h2><p className="mt-1 text-sm text-ink-2">Invite links work once and expire after 48 hours. Ask your manager to send a new one from Users → Reset password → Email link.</p></div>
        <LinkButton href="/login" variant="primary" size="lg" block>Back to sign in</LinkButton>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Card as="section" aria-labelledby="inv-h" className="p-6">
        <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
          <div><h2 id="inv-h" className="text-lg font-semibold">Welcome to Avenue Brand</h2><p className="mt-1 text-sm text-ink-2">Choose a password to activate your account. You will be signed in right after.</p></div>
          <PasswordField id="i-pw" label="Create a password" value={pw} onChange={setPw} placeholder="At least 12 characters" error={error} autoFocus />
          <Checkbox checked={agree} onChange={setAgree} label="I agree to the store's device & data policy" />
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!pw || !agree}>Create account</Button>
        </form>
      </Card>
      <p className="px-1 text-xs text-ink-2">Invite links work once and expire after 48 hours. Sellers never see cost or profit anywhere in the app.</p>
    </div>
  );
}
