'use client';
/**
 * Screen: /setup · Roles: public, first run only
 * Calls: POST /setup → POST /auth/login (via useAuth) → /dashboard.
 * Three steps with a Stepper: Admin · Store · Done.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Stepper } from '@/components/ui/Controls';
import { Field, Input, Select } from '@/components/ui/Field';
import { PasswordField, passwordOk } from './PasswordField';

const STEPS = ['Admin', 'Store', 'Done'];
const CURRENCIES = [['EGP', 'EGP — Egyptian pound'], ['USD', 'USD — US dollar'], ['SAR', 'SAR — Saudi riyal'], ['AED', 'AED — UAE dirham']] as const;
const TIMEZONES = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London'];

export function SetupScreen() {
  const router = useRouter();
  const auth = useAuth();
  const [step, setStep] = useState(0);
  const [admin, setAdmin] = useState({ name: '', email: '', password: '' });
  const [store, setStore] = useState({ storeName: '', currency: 'EGP', timezone: 'Africa/Cairo' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const next = () => {
    const errs: Record<string, string> = {};
    if (!admin.name.trim()) errs.name = 'Your name is required.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(admin.email)) errs.email = 'Enter a valid email.';
    if (!passwordOk(admin.password)) errs.password = 'Use at least 12 characters that are not a common password.';
    setErrors(errs);
    if (!Object.keys(errs).length) setStep(1);
  };

  const finish = async () => {
    if (!store.storeName.trim()) { setErrors({ storeName: 'Store name is required.' }); return; }
    setBusy(true); setErrors({});
    try {
      await api.auth.setup({ name: admin.name.trim(), email: admin.email.trim(), password: admin.password, ...store, storeName: store.storeName.trim() });
      await auth.login(admin.email.trim(), admin.password, true);
      setStep(2);
    } catch (e) {
      setErrors(e instanceof ApiError ? (e.fields ?? { form: e.message }) : { form: (e as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <Card as="section" aria-labelledby="setup-h" className="flex flex-col gap-4 p-6">
      <Stepper steps={STEPS} current={step} onStep={step < 2 ? setStep : undefined} />
      {step === 0 && (
        <form className="flex flex-col gap-3.5" onSubmit={(e) => { e.preventDefault(); next(); }} noValidate>
          <div><h2 id="setup-h" className="text-lg font-semibold">Create the admin account</h2><p className="mt-1 text-sm text-ink-2">This account owns the store and can add everyone else.</p></div>
          <Field label="Your name" htmlFor="a-name" error={errors.name}><Input id="a-name" size="lg" autoComplete="name" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} invalid={!!errors.name} autoFocus /></Field>
          <Field label="Email" htmlFor="a-email" error={errors.email}><Input id="a-email" type="email" size="lg" inputMode="email" autoComplete="username" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} invalid={!!errors.email} /></Field>
          <PasswordField id="a-pw" label="Password" value={admin.password} onChange={(v) => setAdmin({ ...admin, password: v })} error={errors.password} />
          <Button type="submit" variant="primary" size="lg" block>Continue</Button>
        </form>
      )}
      {step === 1 && (
        <form className="flex flex-col gap-3.5" onSubmit={(e) => { e.preventDefault(); void finish(); }} noValidate>
          <div><h2 id="setup-h" className="text-lg font-semibold">Your store</h2><p className="mt-1 text-sm text-ink-2">You can change these later in Settings.</p></div>
          {errors.form && <p role="alert" className="rounded-input bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger-ink">{errors.form}</p>}
          <Field label="Store name" htmlFor="s-name" error={errors.storeName}><Input id="s-name" size="lg" autoComplete="organization" value={store.storeName} onChange={(e) => setStore({ ...store, storeName: e.target.value })} invalid={!!errors.storeName} autoFocus /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Currency" htmlFor="s-cur"><Select id="s-cur" size="lg" value={store.currency} onChange={(e) => setStore({ ...store, currency: e.target.value })}>{CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field label="Timezone" htmlFor="s-tz"><Select id="s-tz" size="lg" value={store.timezone} onChange={(e) => setStore({ ...store, timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          </div>
          <div className="flex gap-2"><Button size="lg" onClick={() => setStep(0)} disabled={busy}>Back</Button><Button type="submit" variant="primary" size="lg" className="flex-1" loading={busy}>Continue</Button></div>
        </form>
      )}
      {step === 2 && (
        <div className="flex flex-col items-center gap-2.5 py-2 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-ok-soft text-ok-ink"><Check className="size-6" aria-hidden /></span>
          <h2 id="setup-h" className="text-lg font-semibold">You&apos;re set up</h2>
          <p className="text-sm text-ink-2">Next: add brands and your first product, or import a CSV.</p>
          <div className="mt-2 flex gap-2"><LinkButton size="sm" variant="primary" href="/products/new">Add product</LinkButton><LinkButton size="sm" href="/settings?section=data">Import CSV</LinkButton></div>
          <Button variant="ghost" size="sm" onClick={() => router.replace('/dashboard')}>Go to dashboard</Button>
        </div>
      )}
    </Card>
  );
}
