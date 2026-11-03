'use client';
/**
 * System screens: 403 (no access), 404, session expired, offline.
 * Roles: all. No API calls except the offline page's cached GET /products.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RefreshCw, SearchX, ShieldAlert, WifiOff } from 'lucide-react';
import { useAuth, homeFor } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatMoney } from '@/lib/format';
import { Button, LinkButton } from '@/components/ui/Button';
import { Badge, RoleBadge, Thumb } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';
import { SearchInput } from '@/components/ui/Controls';
import type { Permission } from '@/types';

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 py-16 text-center">{children}</div>;
}

export function ForbiddenScreen({ permission }: { permission?: Permission }) {
  const auth = useAuth();
  const multi = (auth.user?.roles.length ?? 0) > 1;
  return (
    <Centered>
      <p className="eyebrow">403 · no access</p>
      <ShieldAlert className="size-10 text-warn" aria-hidden />
      <h1 className="text-xl font-semibold">This area is for managers</h1>
      <p className="text-sm text-ink-2">You&apos;re signed in as <RoleBadge role={auth.role} />. Analytics, cost prices, users and settings aren&apos;t part of the seller role.{multi && ' You also hold a manager role — switch roles from your profile.'}{permission && <span className="tabular block pt-1 text-xs text-ink-3">needs {permission}</span>}</p>
      <div className="mt-2 flex gap-2"><LinkButton variant="primary" href={homeFor(auth.role)}>Back to Home</LinkButton>{multi && <LinkButton href="/profile">Switch role</LinkButton>}{auth.viewAsSeller && <Button onClick={() => auth.setViewAsSeller(false)}>Exit seller view</Button>}</div>
    </Centered>
  );
}

export function NotFoundScreen() {
  const auth = useAuth();
  return (
    <Centered>
      <p className="eyebrow">404</p>
      <SearchX className="size-10 text-ink-3" aria-hidden />
      <h1 className="text-xl font-semibold">We can&apos;t find that page</h1>
      <p className="text-sm text-ink-2">The link may be old, or the product may have been archived. Try searching instead.</p>
      <div className="mt-2 flex gap-2"><LinkButton variant="primary" href={auth.user ? homeFor(auth.role) : '/login'}>{auth.user ? 'Go to dashboard' : 'Sign in'}</LinkButton><LinkButton href="/products">Browse products</LinkButton></div>
    </Centered>
  );
}

export function SessionExpiredScreen() {
  const auth = useAuth();
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const email = auth.user?.email ?? 'omar@avenue.eg';
  return (
    <div className="relative min-h-dvh overflow-hidden bg-bg">
      <div aria-hidden className="absolute inset-0 grid grid-cols-3 gap-3 p-6 opacity-30 blur-[1px]">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-24 rounded-card border border-line bg-surface" />)}</div>
      <div className="relative flex min-h-dvh items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <p className="eyebrow">Session expired</p>
          <h1 className="mt-1 text-lg font-semibold">Sign in again to continue</h1>
          <p className="mt-1 text-sm text-ink-2">You were signed out after 12 hours of inactivity. Your unsaved cart is kept on this device.</p>
          <form className="mt-4 flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(undefined); try { await auth.login(email, pw, true); router.replace(homeFor(auth.role)); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } }}>
            <label className="text-[13px] font-medium" htmlFor="se-pw">Password for {email}</label>
            <Input id="se-pw" type="password" size="lg" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" invalid={!!err} />
            {err && <p className="text-xs text-danger-ink" role="alert">{err}</p>}
            <Button type="submit" variant="primary" size="lg" block loading={busy}>Sign in</Button>
            <Link href="/login" className="text-center text-sm text-accent">Use a different account</Link>
          </form>
        </Card>
      </div>
    </div>
  );
}

/** /offline — cached catalogue is browsable; writes are disabled. */
export function OfflineScreen() {
  const [q, setQ] = useState('');
  const products = useApi(() => api.products.list({ q, pageSize: 12 }), [q]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <div role="status" className="flex items-center gap-3 rounded-card bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink"><WifiOff className="size-4" aria-hidden /><span className="flex-1">You&apos;re offline — sales will sync when back online.</span><span className="text-xs">Catalogue cached {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <SearchInput value={q} onChange={setQ} placeholder="Search cached products" size="lg" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {(products.data?.data ?? []).map((p) => <Link key={p.id} href={`/products/${p.id}`} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3"><Thumb tint={p.tint} src={p.coverImage} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="tabular block text-xs text-ink-2">{formatMoney(p.defaultPrice)} · {p.totalQty}</span></span></Link>)}
      </div>
      <Card className="flex items-center gap-3">
        <RefreshCw className="size-5 text-ink-2" aria-hidden />
        <div className="flex-1"><p className="text-sm font-medium">Queued sales sync when you&apos;re back</p><p className="text-xs text-ink-2">Offline sales are a phase-2 feature; today the Charge button waits for a connection.</p></div>
        <Badge tone="warn">Phase 2</Badge>
      </Card>
      <p className="text-xs text-ink-2">Stock counts shown are from the last sync and may be stale. Receiving, adjustments and settings need a connection.</p>
    </div>
  );
}
