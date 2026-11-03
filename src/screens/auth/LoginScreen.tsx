'use client';
/**
 * Screen: /login · Roles: public
 * Calls: POST /auth/login → GET /auth/me (via AuthProvider).
 * Error codes rendered: UNAUTHENTICATED (wrong credentials), ACCOUNT_DISABLED, LOCKED (minutes
 * remaining from retryAfter), RATE_LIMITED.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox, Field, Input } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';

const DEMO = [
  { email: 'omar@avenue.eg', role: 'Admin' },
  { email: 'salma@avenue.eg', role: 'Manager' },
  { email: 'nour@avenue.eg', role: 'Seller + Manager' },
  { email: 'hana@avenue.eg', role: 'Disabled' },
  { email: 'locked@avenue.eg', role: 'Locked out' },
];

export function LoginScreen() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('omar@avenue.eg');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [countdown, setCountdown] = useState(0);
  const next = params.get('next');

  useEffect(() => { if (auth.ready && auth.user) router.replace(next && next !== '/' ? next : homeFor(auth.role)); }, [auth.ready, auth.user, auth.role, router, next]);
  useEffect(() => { if (countdown <= 0) return; const t = setTimeout(() => setCountdown((c) => c - 1), 1000); return () => clearTimeout(t); }, [countdown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const user = await auth.login(email, password, remember);
      router.replace(next && next !== '/' ? next : homeFor(user.role));
    } catch (err) {
      const ae = err instanceof ApiError ? err : new ApiError('INTERNAL', (err as Error).message, 500);
      setError(ae);
      if (ae.retryAfter) setCountdown(ae.retryAfter);
    } finally { setBusy(false); }
  };

  const locked = error?.code === 'LOCKED' && countdown > 0;
  const limited = error?.code === 'RATE_LIMITED' && countdown > 0;
  const minutes = Math.ceil(countdown / 60);
  const BANNERS: Record<string, { title: string; body: string }> = {
    UNAUTHENTICATED: { title: 'Wrong email or password', body: 'Passwords are case-sensitive.' },
    ACCOUNT_DISABLED: { title: 'This account is disabled', body: 'Contact Omar Mansour (Admin) to re-enable it.' },
    LOCKED: { title: 'Too many attempts — locked', body: `Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.` },
    RATE_LIMITED: { title: 'Slow down', body: `Too many requests from this device. Wait ${countdown} seconds and try again.` },
  };
  const banner = error ? (BANNERS[error.code] ?? { title: "Couldn't sign in", body: error.message }) : null;

  return (
    <>
      <Card as="section" aria-labelledby="login-h" className="p-7">
        <h2 id="login-h" className="sr-only">Sign in</h2>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          {banner && (
            <div role="alert" className="flex items-start gap-2.5 rounded-input bg-danger-soft px-3.5 py-3 text-[13px] text-danger-ink">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div><p className="font-semibold">{banner.title}</p><p>{banner.body}</p></div>
            </div>
          )}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" size="lg" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={error?.code === 'UNAUTHENTICATED'} required />
          </Field>
          <Field label="Password" htmlFor="password" trailing={<Link href="/forgot" className="text-[13px] text-accent">Forgot password?</Link>} error={error?.code === 'UNAUTHENTICATED' ? 'Check your email and password. 4 attempts left before a 15-minute lock.' : undefined}>
            <Input id="password" type={showPw ? 'text' : 'password'} size="lg" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={error?.code === 'UNAUTHENTICATED'} required
              trailing={<button type="button" aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw} onClick={() => setShowPw((s) => !s)} className="rounded p-1 hover:bg-surface-2">{showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>} />
          </Field>
          <Checkbox checked={remember} onChange={setRemember} label="Remember this device for 30 days" />
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={locked || limited}>
            {locked ? `Locked · ${minutes} min` : limited ? `Try again in ${countdown} s` : 'Sign in'}
          </Button>
          <p className="text-center text-xs text-ink-2">Sellers: ask your manager for an invite link.</p>
        </form>
      </Card>
      {params.get('demo') && (
        <Card className="mt-4 p-4">
          <p className="text-[13px] font-medium">Demo accounts <span className="text-ink-2">· any password of 10+ characters</span></p>
          <ul className="mt-2 flex flex-col gap-1">
            {DEMO.map((d) => <li key={d.email}><button type="button" onClick={() => { setEmail(d.email); setPassword('correct-horse-battery'); }} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"><span className="tabular">{d.email}</span><Badge>{d.role}</Badge></button></li>)}
          </ul>
        </Card>
      )}
    </>
  );
}
