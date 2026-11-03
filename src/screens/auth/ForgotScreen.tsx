'use client';
/**
 * Screen: /forgot · Roles: public
 * Calls: POST /auth/forgot. Always shows "Check your inbox" (no account enumeration); resend after 60 s.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';

export function ForgotScreen() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [countdown, setCountdown] = useState(0);
  useEffect(() => { if (countdown <= 0) return; const t = setTimeout(() => setCountdown((c) => c - 1), 1000); return () => clearTimeout(t); }, [countdown]);

  const send = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('Enter the email you sign in with.'); return; }
    setBusy(true); setError(undefined);
    try { await api.auth.forgot(email.trim()); setSent(true); setCountdown(60); }
    catch (e) { setError(e instanceof ApiError && e.code === 'RATE_LIMITED' ? `Too many requests. Wait ${e.retryAfter ?? 60} seconds.` : (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Card as="section" aria-labelledby="forgot-h" className="p-6">
        <form className="flex flex-col gap-3.5" onSubmit={(e) => { e.preventDefault(); void send(); }} noValidate>
          <div><h2 id="forgot-h" className="text-lg font-semibold">Reset your password</h2><p className="mt-1 text-sm text-ink-2">We&apos;ll email a link that works for 30 minutes.</p></div>
          <Field label="Email" htmlFor="f-email" error={error}><Input id="f-email" type="email" size="lg" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!error} required autoFocus /></Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={sent && countdown > 0}>{sent ? (countdown > 0 ? `Resend in ${countdown} s` : 'Resend link') : 'Send reset link'}</Button>
          <Link href="/login" className="text-center text-sm text-accent">Back to sign in</Link>
        </form>
      </Card>
      {sent && (
        <Card role="status" className="flex items-start gap-3 p-5">
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
          <div><p className="text-sm font-semibold">Check your inbox</p><p className="mt-0.5 text-xs text-ink-2">If {email} has an account, a link is on its way. Didn&apos;t get it? {countdown > 0 ? <span>Resend in {countdown} s</span> : <button type="button" className="text-accent" onClick={() => void send()}>Resend now</button>}</p></div>
        </Card>
      )}
    </div>
  );
}
