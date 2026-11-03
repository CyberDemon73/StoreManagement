'use client';
/**
 * Screen: /home · Roles: SELLER (managers who open it see the same) · sales.create
 * Calls: GET /sales?from=today&to=today (scoped to the acting user by the API) · GET /stock/low
 *        GET /sales/parked · GET /variants/lookup (Scan → adds to the cart and opens /sell)
 * Never shows profit, cost or stock value.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bookmark, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { listAllPages } from '@/lib/paging';
import { useAuth } from '@/lib/auth-context';
import { dateRangeFor, formatMoney, formatNumber, formatTime, PAYMENT_LABEL, stockStatus } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { BarcodeScannerButton } from '@/components/app/BarcodeScanner';
import { LinkButton } from '@/components/ui/Button';
import { RoleBadge, SaleStatusBadge, StockBadge } from '@/components/ui/Badge';
import { Card, CardHeader, KpiCard } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useCart } from '@/screens/sell/useCart';
import type { VariantWithProduct } from '@/types';

function timeOfDay(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function SellerHomeScreen() {
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { actions } = useCart();
  const today = dateRangeFor('today');
  const sales = useApi(() => listAllPages((page, pageSize) => api.sales.list({ from: today.from, to: today.to, page, pageSize })), [today.from]);
  const low = useApi(() => api.stock.low(), []);
  const parked = useApi(() => api.sales.parked(), []);

  const rows = (sales.data?.data ?? []).filter((s) => s.status !== 'VOID');
  const revenue = rows.reduce((a, s) => a + s.total, 0);
  const firstName = auth.user?.name.split(' ')[0] ?? '';
  const lowRows = low.data ? [...low.data.out, ...low.data.low].slice(0, 3) : [];

  const onScan = (v: VariantWithProduct) => {
    if (v.quantity <= 0) { toast({ kind: 'error', title: `${v.product.name} ${v.size} · ${v.color.name} is out of stock` }); return; }
    actions.add(v, { id: v.product.id, name: v.product.name, tint: v.product.tint });
    toast({ kind: 'success', title: `Added ${v.product.name}`, body: `${v.size} · ${v.color.name}` });
    router.push('/sell');
  };

  return (
    <>
      <PageHeader title="Home" compactTitle="Home" className="hidden!" />
      <Page className="max-w-[720px] gap-3.5">
        <header className="flex items-center gap-3 pt-1">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-2">{timeOfDay()},</p>
            <h1 className="truncate text-[22px] font-semibold leading-tight">{firstName || 'there'}</h1>
          </div>
          <RoleBadge role={auth.role} />
        </header>

        <LinkButton href="/sell" variant="primary" size="xl" block className="min-h-18 rounded-[14px] text-[19px]" leading={<Plus strokeWidth={2.25} />}>New sale</LinkButton>
        <div className="grid grid-cols-2 gap-2">
          <BarcodeScannerButton onScan={onScan} size="lg" />
          <LinkButton href="/sell" size="lg" leading={<Bookmark />}>Parked{parked.data ? ` · ${parked.data.length}` : ''}</LinkButton>
        </div>

        <section aria-label="Today" className="grid grid-cols-2 gap-2.5">
          <KpiCard label="My sales today" value={sales.data ? formatNumber(rows.length) : '—'} loading={sales.initial} sub={rows.length === 0 && sales.data ? 'No sales yet today' : undefined} />
          <KpiCard label="My revenue" value={sales.data ? formatMoney(revenue, 'EGP', { compact: true }) : '—'} loading={sales.initial} sub={rows.length ? `EGP · avg ${formatMoney(Math.round(revenue / rows.length), 'EGP', { compact: true })}` : 'EGP'} />
        </section>
        {sales.error && !sales.data && <ErrorState compact error={sales.error} onRetry={() => void sales.refetch()} />}

        <Card className="flex flex-col gap-1.5 px-4 py-3.5 md:px-4 md:py-3.5">
          <CardHeader title="Running low" action={<span className="text-xs text-ink-2">tell a manager</span>} />
          {low.initial ? <div className="flex flex-col gap-2 pt-1">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-3/4" />)}</div>
            : low.error && !low.data ? <ErrorState compact error={low.error} onRetry={() => void low.refetch()} />
            : lowRows.length === 0 ? <p className="text-sm text-ink-2">Nothing is low right now.</p>
            : (
              <ul className="flex flex-col gap-1.5 pt-0.5">
                {lowRows.map((v) => (
                  <li key={v.id} className="flex min-h-7 items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{v.product.name} · {v.size} · {v.color.name}</span><StockBadge status={stockStatus(v.quantity, v.lowStockThreshold)} qty={v.quantity > 0 ? v.quantity : undefined} /></li>
                ))}
              </ul>
            )}
        </Card>

        <Card padded={false} className="px-4 pt-3.5">
          <CardHeader title="My recent sales" action={<Link href="/my-sales" className="text-sm text-accent">All</Link>} />
          <ul className="mt-1 flex flex-col">
            {sales.initial ? Array.from({ length: 3 }).map((_, i) => <li key={i} className="py-2.5"><Skeleton className="h-9" /></li>)
              : rows.length === 0 ? <li><EmptyState compact title="No sales yet today" body="Your first sale of the day will show here." /></li>
              : rows.slice(0, 3).map((s) => (
                <li key={s.id} className="border-b border-line last:border-0">
                  <Link href={`/my-sales?open=${s.id}`} className="flex min-h-12 items-center gap-3 py-1">
                    <div className="min-w-0 flex-1">
                      <p className="tabular text-sm font-semibold">{s.number}{s.status !== 'COMPLETED' && <span className="ml-2 inline-block align-middle"><SaleStatusBadge status={s.status} /></span>}</p>
                      <p className="text-xs text-ink-2">{s.items.length} item{s.items.length === 1 ? '' : 's'} · {PAYMENT_LABEL[s.paymentMethod]} · {formatTime(s.createdAt)}</p>
                    </div>
                    <span className="tabular font-semibold">{formatMoney(s.total)}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </Card>
      </Page>
    </>
  );
}
