'use client';
/** Analytics · Sales tab. Calls: GET /analytics/sales-trend, /analytics/payment-mix, /analytics/sellers (discounts). */
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatDate, formatMoney, formatNumber, formatPct, PAYMENT_LABEL } from '@/lib/format';
import { KpiCard } from '@/components/ui/Card';
import { ChartCard, CHART_COLORS, DonutChart, TrendChart, trendSummary } from '@/components/app/Charts';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, ErrorState } from '@/components/ui/States';
import type { TrendPoint } from '@/types';
import { ChartSkeleton, KpiGrid, type TabProps } from './shared';

export function SalesTab({ range }: TabProps) {
  const trend = useApi(() => api.analytics.trend(range.from, range.to), [range.from, range.to]);
  const mix = useApi(() => api.analytics.paymentMix(range.from, range.to), [range.from, range.to]);
  const sellers = useApi(() => api.analytics.sellers(range.from, range.to), [range.from, range.to]);

  if (trend.error && !trend.data) return <ErrorState error={trend.error} onRetry={() => void trend.refetch()} />;
  const t = trend.data;
  const revenue = t?.reduce((a, p) => a + p.revenue, 0) ?? 0;
  const count = t?.reduce((a, p) => a + p.count, 0) ?? 0;
  const discount = sellers.data?.reduce((a, s) => a + s.discountGiven, 0) ?? 0;
  const loading = trend.initial;

  const columns: Column<TrendPoint>[] = [
    { key: 'day', header: 'Day', cell: (r) => <span className="tabular">{formatDate(r.bucket)}</span> },
    { key: 'count', header: 'Sales', align: 'right', cell: (r) => formatNumber(r.count) },
    { key: 'revenue', header: 'Revenue', align: 'right', cell: (r) => <span className="font-semibold">{formatMoney(r.revenue)}</span> },
    { key: 'basket', header: 'Avg basket', align: 'right', cell: (r) => (r.count ? formatMoney(Math.round(r.revenue / r.count)) : '—') },
  ];

  return (
    <>
      <KpiGrid loading={loading}>
        <KpiCard label="Revenue" value={formatMoney(revenue, 'EGP', { compact: true })} sub={range.label} />
        <KpiCard label="Sales" value={formatNumber(count)} sub={`${t?.filter((p) => p.count > 0).length ?? 0} active days`} />
        <KpiCard label="Avg basket" value={formatMoney(count ? Math.round(revenue / count) : 0, 'EGP', { compact: true })} sub="EGP per sale" />
        <KpiCard label="Discount given" value={sellers.data ? formatMoney(discount, 'EGP', { compact: true }) : '…'} sub={revenue ? `${formatPct((discount / (revenue + discount)) * 100)} of gross` : undefined} />
      </KpiGrid>
      <section className="grid gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Revenue trend" description="Daily revenue" fallback={t ? trendSummary(t) : undefined}>
          {t ? (t.length ? <TrendChart data={t} showProfit={false} /> : <EmptyState compact title="No sales in this range" body="Pick a wider date range." />) : <ChartSkeleton />}
        </ChartCard>
        <ChartCard title="Payment mix" fallback={mix.data ? mix.data.map((m) => `${PAYMENT_LABEL[m.method]} ${formatPct(revenue ? (m.total / revenue) * 100 : 0, 0)}`).join(' · ') : undefined}>
          {mix.error && !mix.data ? <ErrorState compact error={mix.error} onRetry={() => void mix.refetch()} /> : mix.data ? (
            <div className="flex items-center gap-5">
              <DonutChart data={mix.data.map((m) => ({ name: PAYMENT_LABEL[m.method] ?? m.method, value: m.total }))} center={{ value: String(mix.data.reduce((a, m) => a + m.count, 0)), label: 'sales' }} />
              <ul className="flex flex-1 flex-col gap-2.5">
                {mix.data.map((m, i) => <li key={m.method} className="flex items-center gap-2 text-sm"><span aria-hidden className="size-3 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} /><span className="flex-1 truncate">{PAYMENT_LABEL[m.method]}</span><span className="tabular font-semibold">{formatMoney(m.total, 'EGP', { compact: true })}</span><span className="tabular w-10 text-right text-ink-2">{m.count}</span></li>)}
              </ul>
            </div>
          ) : <ChartSkeleton height={140} />}
        </ChartCard>
      </section>
      <DataTable aria-label="Sales by day" columns={columns} rows={t ? [...t].reverse() : undefined} rowKey={(r) => r.bucket} loading={trend.loading} error={trend.error} onRetry={() => void trend.refetch()} compact
        empty={<EmptyState compact title="No sales in this range" body={`Nothing was sold between ${formatDate(range.from)} and ${formatDate(range.to)}.`} />}
        footer={t ? <span className="text-ink-2">{t.length} day{t.length === 1 ? '' : 's'} · {formatMoney(revenue, 'EGP', { withCurrency: true, compact: true })}</span> : undefined} />
    </>
  );
}
