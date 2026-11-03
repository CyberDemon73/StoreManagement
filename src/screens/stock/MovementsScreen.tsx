'use client';
/**
 * Screen: /stock/movements · Roles: ADMIN, MANAGER (stock.read.ledger)
 * Calls: GET /stock/movements?variantId&type&from&to&userId&q&page&pageSize · GET /users (user filter)
 * The ledger is append-only; every row links to its reference (sale, purchase, return, count).
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useBreakpoint, useDebounced } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { useDateRange } from '@/lib/use-date-range';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatMoney, formatTime, MOVEMENT_LABEL } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, Chip, ColorSwatch } from '@/components/ui/Badge';
import { DateRangePicker, SearchInput } from '@/components/ui/Controls';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { ChipMenu } from './ChipMenu';
import { deltaClass, downloadCsv, MOVEMENT_TONE, MOVEMENT_TYPES, referenceHref, signedQty, variantTitle } from './stock-utils';
import type { MovementType, StockMovement } from '@/types';

export function MovementsScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
  const bp = useBreakpoint();
  const variantId = params.get('variantId') ?? undefined;

  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [type, setType] = useState<MovementType>();
  const [userId, setUserId] = useState<string>();
  const [range, setRange] = useDateRange('7d');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const users = useApi(() => api.users.list(), [], { enabled: auth.isManager });
  const list = useApi(() => api.stock.movements({ variantId, type, userId, q: dq || undefined, from: range.from, to: range.to, page, pageSize }), [variantId, type, userId, dq, range.from, range.to, page, pageSize]);
  const rows = list.data?.data;
  const total = list.data?.total ?? 0;
  const showCost = auth.isManager;
  const variantLabel = useMemo(() => { const m = rows?.find((r) => r.variantId === variantId); return m ? variantTitle(m.variant.productName, m.variant.size, m.variant.color.name) : undefined; }, [rows, variantId]);

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const exportCsv = () => {
    if (!rows?.length) return;
    downloadCsv(`movements-${range.from}-${range.to}.csv`, ['Date', 'Product', 'Size', 'Color', 'SKU', 'Type', 'Delta', ...(showCost ? ['Unit cost'] : []), 'After', 'Reference', 'User'],
      rows.map((m) => [m.createdAt, m.variant.productName, m.variant.size, m.variant.color.name, m.variant.sku, m.type, m.qtyDelta, ...(showCost ? [m.unitCost === undefined ? '' : (m.unitCost / 100).toFixed(2)] : []), m.qtyAfter, m.reference?.label ?? m.reason ?? '', m.userName]));
  };

  const columns: Column<StockMovement>[] = [
    { key: 'date', header: 'Date', cell: (m) => <span className="tabular whitespace-nowrap text-xs text-ink-2">{formatDate(m.createdAt)} {formatTime(m.createdAt)}</span> },
    { key: 'variant', header: 'Variant', cell: (m) => (
      <div className="flex items-center gap-2.5"><ColorSwatch hex={m.variant.color.hex} name={m.variant.color.name} /><div className="min-w-0"><p className="truncate text-sm font-medium">{variantTitle(m.variant.productName, m.variant.size, m.variant.color.name)}</p><p className="tabular text-xs text-ink-2">{m.variant.sku}</p></div></div>
    ) },
    { key: 'type', header: 'Type', cell: (m) => <Badge tone={MOVEMENT_TONE[m.type]}>{MOVEMENT_LABEL[m.type]}</Badge> },
    { key: 'delta', header: 'Δ qty', align: 'right', cell: (m) => <span className={cn('font-semibold', deltaClass(m.qtyDelta))}>{signedQty(m.qtyDelta)}</span> },
    { key: 'cost', header: 'Unit cost', align: 'right', when: showCost, cell: (m) => <span className="text-ink-2">{m.unitCost === undefined ? '—' : formatMoney(m.unitCost)}</span> },
    { key: 'after', header: 'After', align: 'right', cell: (m) => m.qtyAfter },
    { key: 'ref', header: 'Reference', cell: (m) => <Reference m={m} /> },
    { key: 'user', header: 'User', cell: (m) => <span className="text-xs text-ink-2">{m.userName.split(' ')[0]}</span> },
  ];

  const filtersLabel = [type ? MOVEMENT_LABEL[type] : null, dq ? `“${dq}”` : null, variantLabel].filter(Boolean).join(', ');
  const empty = <EmptyState compact title="No movements in this range" body={`Nothing matched ${filtersLabel || 'the current filters'} between ${formatDate(range.from)} and ${formatDate(range.to)}.`} action={<Button size="sm" onClick={() => { setType(undefined); setUserId(undefined); setQ(''); setPage(1); }}>Clear filters</Button>} />;

  return (
    <>
      <PageHeader title="Movements" crumbs={[{ label: 'Stock' }, { label: 'Movements' }]} actions={<Button leading={<Download />} onClick={exportCsv} disabled={!rows?.length}>Export CSV</Button>} />
      <Page>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={resetPage(setQ)} placeholder="Variant, SKU or reference" aria-label="Search movements" className="w-full md:w-[300px]" />
          <ChipMenu label="Type" value={type} onChange={resetPage(setType)} options={MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_LABEL[t] }))} />
          <DateRangePicker value={range} onChange={resetPage(setRange)} compact />
          {auth.isManager && <ChipMenu label="User" value={userId} onChange={resetPage(setUserId)} options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />}
          {variantId && <Chip selected onRemove={() => router.replace('/stock/movements')}>Variant: {variantLabel ?? variantId}</Chip>}
          <div className="ml-auto hidden items-center gap-1.5 text-xs md:flex" aria-label="Type legend">
            {MOVEMENT_TYPES.map((t) => <Badge key={t} tone={MOVEMENT_TONE[t]}>{MOVEMENT_LABEL[t]}</Badge>)}
          </div>
        </div>

        {bp === 'mobile' ? (
          <MobileTimeline rows={rows} loading={list.initial} error={list.error} onRetry={() => void list.refetch()} empty={empty} showCost={showCost} page={page} pageSize={pageSize} total={total} onPage={setPage} />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(m) => m.id} loading={list.loading} error={list.error} onRetry={() => void list.refetch()} empty={empty} aria-label="Stock movements"
            page={{ page, pageSize, total, onPage: setPage, onPageSize: (n) => { setPageSize(n); setPage(1); } }} footer={<span className="text-xs text-ink-2">{total.toLocaleString()} movement{total === 1 ? '' : 's'}</span>} />
        )}
      </Page>
    </>
  );
}

function Reference({ m }: { m: StockMovement }) {
  if (m.reference) return <Link href={referenceHref(m.reference)} className="tabular text-sm text-accent hover:underline">{m.reference.label}</Link>;
  if (m.reason) return <span className="text-sm text-ink-2">{m.reason}</span>;
  if (m.type === 'INITIAL') return <span className="text-sm text-ink-2">Product created</span>;
  return <span className="text-ink-3">—</span>;
}

function MobileTimeline({ rows, loading, error, onRetry, empty, showCost, page, pageSize, total, onPage }: { rows: StockMovement[] | undefined; loading: boolean; error?: import('@/lib/api').ApiError; onRetry: () => void; empty: React.ReactNode; showCost: boolean; page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  if (loading && !rows) return <SkeletonRows rows={8} />;
  if (error && !rows) return <ErrorState error={error} onRetry={onRetry} compact />;
  if (!rows) return null;
  if (rows.length === 0) return <>{empty}</>;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-col gap-3">
      <ol className="relative flex flex-col gap-3 border-l border-line pl-4" aria-label="Stock movements">
        {rows.map((m) => (
          <li key={m.id} className="relative rounded-card border border-line bg-surface p-3">
            <span aria-hidden className={cn('absolute -left-[21px] top-4 size-2.5 rounded-full border-2 border-surface', m.qtyDelta > 0 ? 'bg-ok' : m.qtyDelta < 0 ? 'bg-danger' : 'bg-line')} />
            <div className="flex items-center justify-between gap-2 text-xs text-ink-2"><span className="tabular">{formatDateTime(m.createdAt)}</span><Badge tone={MOVEMENT_TONE[m.type]}>{MOVEMENT_LABEL[m.type]}</Badge></div>
            <div className="mt-1.5 flex items-center gap-2.5">
              <ColorSwatch hex={m.variant.color.hex} name={m.variant.color.name} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{variantTitle(m.variant.productName, m.variant.size, m.variant.color.name)}</p><p className="tabular text-xs text-ink-2">{m.variant.sku}</p></div>
              <div className="text-right"><p className={cn('tabular text-base font-semibold', deltaClass(m.qtyDelta))}>{signedQty(m.qtyDelta)}</p><p className="tabular text-xs text-ink-2">after {m.qtyAfter}</p></div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs"><Reference m={m} /><span className="text-ink-2">{m.userName.split(' ')[0]}{showCost && m.unitCost !== undefined ? ` · ${formatMoney(m.unitCost)}` : ''}</span></div>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between text-sm">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="tabular text-xs text-ink-2">{page} / {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
