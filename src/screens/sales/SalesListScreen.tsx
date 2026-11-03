'use client';
/**
 * Screen: /sales · Roles: ADMIN, MANAGER (sales.read); SELLER sees own sales only (enforced server-side), no Void
 * Calls: GET /sales?from&to&sellerId&paymentMethod&status&q&page&pageSize · GET /users (seller filter, managers)
 *        GET /sales/:id · POST /sales/:id/void (panel) · ?open=saleId opens the detail panel
 */
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useBreakpoint, useDebounced } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { useDateRange } from '@/lib/use-date-range';
import { cn } from '@/lib/cn';
import { formatMoney, formatNumber, formatTime, PAYMENT_LABEL, SALE_STATUS_LABEL } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { KpiCard } from '@/components/ui/Card';
import { Badge, SaleStatusBadge } from '@/components/ui/Badge';
import { DateRangePicker, SearchInput } from '@/components/ui/Controls';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, ErrorState, SkeletonKpis, SkeletonRows } from '@/components/ui/States';
import { ChipMenu } from '@/screens/stock/ChipMenu';
import { downloadCsv } from '@/screens/stock/stock-utils';
import { SaleDetailPanel } from './SaleDetailPanel';
import type { PaymentMethod, Sale, SaleStatus } from '@/types';

const PAYMENTS: PaymentMethod[] = ['CASH', 'CARD', 'WALLET', 'TRANSFER'];
const STATUSES: SaleStatus[] = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOID'];

export function SalesListScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
  const bp = useBreakpoint();
  const openId = params.get('open') ?? undefined;

  const [range, setRange] = useDateRange('today');
  const [sellerId, setSellerId] = useState<string>();
  const [payment, setPayment] = useState<PaymentMethod>();
  const [status, setStatus] = useState<SaleStatus>();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const users = useApi(() => api.users.list(), [], { enabled: auth.isManager });
  const list = useApi(() => api.sales.list({ from: range.from, to: range.to, sellerId, paymentMethod: payment, status, q: dq || undefined, page, pageSize }), [range.from, range.to, sellerId, payment, status, dq, page, pageSize]);
  const rows = list.data?.data;
  const total = list.data?.total ?? 0;
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const live = rows?.filter((s) => s.status !== 'VOID') ?? [];
  const revenue = live.reduce((a, s) => a + s.total, 0);
  const refunds = (rows ?? []).reduce((a, s) => a + s.returns.reduce((b, r) => b + r.refundAmount, 0), 0);
  const avgBasket = live.length ? Math.round(revenue / live.length) : 0;
  const isToday = range.preset === 'today';

  const openSale = (id?: string) => router.replace(id ? `/sales?open=${id}` : '/sales', { scroll: false });
  const onChanged = (s: Sale) => list.setData((d) => d && { ...d, data: d.data.map((x) => (x.id === s.id ? s : x)) });

  const exportCsv = () => {
    if (!rows?.length) return;
    downloadCsv(`sales-${range.from}-${range.to}.csv`, ['Number', 'Date', 'Seller', 'Items', 'Payment', 'Subtotal', 'Discount', 'Total', 'Status', 'Customer'],
      rows.map((s) => [s.number, s.createdAt, s.sellerName, s.items.reduce((a, i) => a + i.qty, 0), PAYMENT_LABEL[s.paymentMethod], (s.subtotal / 100).toFixed(2), (s.discount / 100).toFixed(2), (s.total / 100).toFixed(2), SALE_STATUS_LABEL[s.status], s.customerName ?? '']));
  };

  const columns: Column<Sale>[] = [
    { key: 'number', header: 'Sale', cell: (s) => <span className="tabular font-semibold">{s.number}</span> },
    { key: 'time', header: 'Time', cell: (s) => <span className="tabular text-xs text-ink-2">{formatTime(s.createdAt)}</span> },
    { key: 'seller', header: 'Seller', when: auth.isManager, cell: (s) => s.sellerName.split(' ')[0] },
    { key: 'items', header: 'Items', align: 'right', cell: (s) => s.items.reduce((a, i) => a + i.qty, 0) },
    { key: 'payment', header: 'Payment', cell: (s) => <Badge>{PAYMENT_LABEL[s.paymentMethod]}</Badge> },
    { key: 'discount', header: 'Discount', align: 'right', cell: (s) => <span className="text-ink-2">{s.discount > 0 ? `−${formatMoney(s.discount)}` : '—'}</span> },
    { key: 'total', header: 'Total', align: 'right', cell: (s) => <span className={cn('font-semibold', s.status === 'VOID' && 'line-through')}>{formatMoney(s.total)}</span> },
    { key: 'status', header: 'Status', cell: (s) => <SaleStatusBadge status={s.status} /> },
    { key: 'customer', header: 'Customer', cell: (s) => <span className="text-xs text-ink-2">{s.status === 'VOID' && s.voidReason ? `${s.voidReason}` : s.customerName ?? 'Walk-in'}{s.customerPhone ? ` · ${s.customerPhone}` : ''}</span> },
  ];
  const activeFilters = [sellerId ? users.data?.find((u) => u.id === sellerId)?.name : null, payment ? PAYMENT_LABEL[payment] : null, status ? SALE_STATUS_LABEL[status] : null, dq ? `“${dq}”` : null].filter(Boolean).join(', ');
  const empty = <EmptyState compact title={`No sales ${isToday ? 'today' : 'in this range'}`} body={activeFilters ? `Nothing matched ${activeFilters} for ${range.label}.` : `Nothing was sold for ${range.label}.`} action={activeFilters ? <Button size="sm" onClick={() => { setSellerId(undefined); setPayment(undefined); setStatus(undefined); setQ(''); setPage(1); }}>Clear filters</Button> : auth.can('sales.create') ? <LinkButton size="sm" variant="primary" href="/sell">New sale</LinkButton> : undefined} />;

  return (
    <>
      <PageHeader title={auth.isManager ? 'Sales' : 'My sales'} actions={<><Button leading={<Download />} onClick={exportCsv} disabled={!rows?.length}>Export CSV</Button>{auth.can('sales.create') && <LinkButton variant="primary" href="/sell">New sale</LinkButton>}</>} />
      <Page>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={resetPage(setRange)} compact />
          {auth.isManager && <ChipMenu label="Seller" value={sellerId} onChange={resetPage(setSellerId)} options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />}
          <ChipMenu label="Payment" value={payment} onChange={resetPage(setPayment)} options={PAYMENTS.map((p) => ({ value: p, label: PAYMENT_LABEL[p] }))} />
          <ChipMenu label="Status" value={status} onChange={resetPage(setStatus)} options={STATUSES.map((s) => ({ value: s, label: SALE_STATUS_LABEL[s] }))} />
          <SearchInput value={q} onChange={resetPage(setQ)} placeholder="Sale number or customer" aria-label="Search sales" className="w-full md:ml-auto md:w-[260px]" />
        </div>

        <section aria-label="Key figures" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {list.initial ? <SkeletonKpis count={4} /> : (
            <>
              <KpiCard compact label={isToday ? 'Sales today' : 'Sales'} value={formatNumber(live.length)} sub={total > live.length ? `${total} rows incl. void` : undefined} />
              <KpiCard compact label="Revenue" value={formatMoney(revenue, 'EGP', { compact: true })} />
              <KpiCard compact label="Refunds" value={formatMoney(refunds, 'EGP', { compact: true })} invert />
              <KpiCard compact label="Avg basket" value={formatMoney(avgBasket, 'EGP', { compact: true })} />
            </>
          )}
        </section>

        {bp === 'mobile' ? (
          <MobileSales rows={rows} loading={list.initial} error={list.error} onRetry={() => void list.refetch()} empty={empty} onOpen={openSale} showSeller={auth.isManager} page={page} pageSize={pageSize} total={total} onPage={setPage} />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(s) => s.id} loading={list.loading} error={list.error} onRetry={() => void list.refetch()} empty={empty} onRowClick={(s) => openSale(s.id)} aria-label="Sales"
            rowClassName={(s) => (s.status === 'VOID' ? 'opacity-60' : s.id === openId ? 'bg-accent-soft/60' : undefined)}
            page={{ page, pageSize, total, onPage: setPage, onPageSize: (n) => { setPageSize(n); setPage(1); } }} footer={<span className="text-xs text-ink-2">{total} sale{total === 1 ? '' : 's'} · {range.label}</span>} />
        )}
      </Page>

      <SaleDetailPanel saleId={openId} fallback={rows?.find((s) => s.id === openId)} onClose={() => openSale(undefined)} onChanged={onChanged} />
    </>
  );
}

function MobileSales({ rows, loading, error, onRetry, empty, onOpen, showSeller, page, pageSize, total, onPage }: { rows: Sale[] | undefined; loading: boolean; error?: import('@/lib/api').ApiError; onRetry: () => void; empty: React.ReactNode; onOpen: (id: string) => void; showSeller: boolean; page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  if (loading && !rows) return <SkeletonRows rows={8} />;
  if (error && !rows) return <ErrorState error={error} onRetry={onRetry} compact />;
  if (!rows) return null;
  if (rows.length === 0) return <>{empty}</>;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((s) => (
        <button key={s.id} type="button" onClick={() => onOpen(s.id)} className={cn('flex min-h-11 flex-col gap-1 rounded-card border border-line bg-surface px-4 py-3 text-left', s.status === 'VOID' && 'opacity-60')}>
          <div className="flex items-center justify-between gap-2"><span className="tabular text-sm font-semibold">{s.number}</span><span className={cn('tabular text-sm font-semibold', s.status === 'VOID' && 'line-through')}>{formatMoney(s.total)}</span></div>
          <div className="flex items-center justify-between gap-2 text-xs text-ink-2"><span className="tabular">{formatTime(s.createdAt)}{showSeller ? ` · ${s.sellerName.split(' ')[0]}` : ''} · {s.items.reduce((a, i) => a + i.qty, 0)} item{s.items.length === 1 ? '' : 's'} · {PAYMENT_LABEL[s.paymentMethod]}</span>{s.status !== 'COMPLETED' && <SaleStatusBadge status={s.status} />}</div>
        </button>
      ))}
      <div className="flex items-center justify-between text-sm"><Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><span className="tabular text-xs text-ink-2">{page} / {pages}</span><Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button></div>
    </div>
  );
}
