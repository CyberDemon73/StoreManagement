'use client';
/** Analytics · Sellers tab. Calls: GET /analytics/sellers. Return rate above 6% is highlighted. */
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { formatMoney, formatNumber, formatPct } from '@/lib/format';
import { KpiCard } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, ErrorState } from '@/components/ui/States';
import type { SellerStats } from '@/types';
import { KpiGrid, type TabProps } from './shared';

const RETURN_WARN_PCT = 6;

export function SellersTab({ range }: TabProps) {
  const sellers = useApi(() => api.analytics.sellers(range.from, range.to), [range.from, range.to]);
  if (sellers.error && !sellers.data) return <ErrorState error={sellers.error} onRetry={() => void sellers.refetch()} />;
  const s = sellers.data;
  const revenue = s?.reduce((a, x) => a + x.revenue, 0) ?? 0;
  const sales = s?.reduce((a, x) => a + x.salesCount, 0) ?? 0;
  const top = s && s.length ? s.reduce((a, x) => (x.revenue > a.revenue ? x : a)) : undefined;
  const flagged = s?.filter((x) => x.returnRatePct > RETURN_WARN_PCT).length ?? 0;

  const columns: Column<SellerStats>[] = [
    { key: 'name', header: 'Seller', cell: (r) => <span className="flex items-center gap-2.5"><Avatar name={r.name} size="sm" /><span className="font-medium">{r.name}</span></span> },
    { key: 'sales', header: 'Sales', align: 'right', cell: (r) => formatNumber(r.salesCount) },
    { key: 'revenue', header: 'Revenue', align: 'right', cell: (r) => <span className="font-semibold">{formatMoney(r.revenue)}</span> },
    { key: 'basket', header: 'Avg basket', align: 'right', cell: (r) => formatMoney(r.avgBasket) },
    { key: 'discount', header: 'Discounts given', align: 'right', cell: (r) => (r.discountGiven ? `${formatMoney(r.discountGiven)} · ${formatPct(r.discountPct)}` : formatMoney(0)) },
    { key: 'returns', header: 'Returns', align: 'right', cell: (r) => formatNumber(r.returnsCount) },
    { key: 'rate', header: 'Return rate', align: 'right', cell: (r) => <span className={cn(r.returnRatePct > RETURN_WARN_PCT && 'font-semibold text-warn-ink')} title={r.returnRatePct > RETURN_WARN_PCT ? `Above ${RETURN_WARN_PCT}%` : undefined}>{formatPct(r.returnRatePct)}{r.returnRatePct > RETURN_WARN_PCT && <span className="sr-only"> (high)</span>}</span> },
  ];

  return (
    <>
      <KpiGrid loading={sellers.initial}>
        <KpiCard label="Active sellers" value={String(s?.filter((x) => x.salesCount > 0).length ?? 0)} sub={range.label} />
        <KpiCard label="Top seller" value={top?.name.split(' ')[0] ?? '—'} sub={top ? `${formatMoney(top.revenue, 'EGP', { compact: true })} · ${top.salesCount} sales` : undefined} />
        <KpiCard label="Avg basket" value={formatMoney(sales ? Math.round(revenue / sales) : 0, 'EGP', { compact: true })} sub="across all sellers" />
        <KpiCard label="High return rate" value={String(flagged)} unit={flagged === 1 ? 'seller' : 'sellers'} sub={`above ${RETURN_WARN_PCT}%`} />
      </KpiGrid>
      <DataTable aria-label="Sellers" columns={columns} rows={s} rowKey={(r) => r.userId} loading={sellers.loading} error={sellers.error} onRetry={() => void sellers.refetch()}
        rowClassName={(r) => (r.returnRatePct > RETURN_WARN_PCT ? 'bg-warn-soft/30' : undefined)}
        empty={<EmptyState compact title="No sales in this range" body="Pick a wider date range." />}
        footer={<span className="text-ink-2">Return rate above {RETURN_WARN_PCT}% is highlighted.</span>} />
    </>
  );
}
