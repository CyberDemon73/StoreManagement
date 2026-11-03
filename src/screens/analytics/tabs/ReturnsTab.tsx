'use client';
/** Analytics · Returns tab. Calls: GET /analytics/returns. */
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatMoney, formatNumber, formatPct } from '@/lib/format';
import { KpiCard } from '@/components/ui/Card';
import { BarsChart, ChartCard } from '@/components/app/Charts';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, ErrorState } from '@/components/ui/States';
import type { ReturnsReport } from '@/types';
import { ChartSkeleton, KpiGrid, type TabProps } from './shared';

type Reason = ReturnsReport['byReason'][number];

export function ReturnsTab({ range }: TabProps) {
  const rep = useApi(() => api.analytics.returns(range.from, range.to), [range.from, range.to]);
  if (rep.error && !rep.data) return <ErrorState error={rep.error} onRetry={() => void rep.refetch()} />;
  const r = rep.data;
  const topReason = r && r.byReason.length ? r.byReason.reduce((a, x) => (x.count > a.count ? x : a)) : undefined;

  const columns: Column<Reason>[] = [
    { key: 'reason', header: 'Reason', cell: (x) => <span className="font-medium">{x.reason}</span> },
    { key: 'count', header: 'Returns', align: 'right', cell: (x) => formatNumber(x.count) },
    { key: 'share', header: 'Share', align: 'right', cell: (x) => formatPct(r && r.count ? (x.count / r.count) * 100 : 0, 0) },
    { key: 'value', header: 'Refunded', align: 'right', cell: (x) => <span className="font-semibold">{formatMoney(x.value)}</span> },
  ];

  return (
    <>
      <KpiGrid loading={rep.initial} count={3}>
        <KpiCard label="Return rate" value={formatPct(r?.ratePct ?? 0)} invert sub="returns ÷ sales" />
        <KpiCard label="Returns" value={formatNumber(r?.count ?? 0)} sub={range.label} />
        <KpiCard label="Refunded" value={formatMoney(r?.value ?? 0, 'EGP', { compact: true })} sub="EGP refunded to customers" />
      </KpiGrid>
      <section className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Returns by reason" fallback={r ? (r.byReason.length ? `${topReason?.reason} is the most common reason (${topReason?.count}). ${r.byReason.map((x) => `${x.reason} ${x.count}`).join(' · ')}` : 'No returns in this range.') : undefined}>
          {r ? (r.byReason.length ? <BarsChart data={r.byReason.map((x) => ({ reason: x.reason, count: x.count }))} xKey="reason" series={[{ key: 'count', label: 'Returns' }]} layout="vertical" height={Math.max(160, r.byReason.length * 36)} /> : <EmptyState compact title="No returns in this range" body="That is good news." />) : <ChartSkeleton />}
        </ChartCard>
        <DataTable aria-label="Returns by reason" columns={columns} rows={r?.byReason} rowKey={(x) => x.reason} loading={rep.loading} error={rep.error} onRetry={() => void rep.refetch()} compact
          empty={<EmptyState compact title="No returns in this range" />}
          footer={r ? <span className="text-ink-2">{r.count} return{r.count === 1 ? '' : 's'} · {formatMoney(r.value, 'EGP', { withCurrency: true, compact: true })}</span> : undefined} />
      </section>
    </>
  );
}
