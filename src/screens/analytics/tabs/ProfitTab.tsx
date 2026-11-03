'use client';
/** Analytics · Profit tab. Calls: GET /analytics/sales-trend, /analytics/top-products?by=profit. */
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatMoney, formatNumber, formatPct } from '@/lib/format';
import { KpiCard } from '@/components/ui/Card';
import { ChartCard, TrendChart, trendSummary } from '@/components/app/Charts';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, ErrorState } from '@/components/ui/States';
import type { TopProduct } from '@/types';
import { ChartSkeleton, KpiGrid, type TabProps } from './shared';

export function ProfitTab({ range }: TabProps) {
  const trend = useApi(() => api.analytics.trend(range.from, range.to), [range.from, range.to]);
  const top = useApi(() => api.analytics.topProducts(range.from, range.to, 'profit', 10), [range.from, range.to]);

  if (trend.error && !trend.data) return <ErrorState error={trend.error} onRetry={() => void trend.refetch()} />;
  const t = trend.data;
  const revenue = t?.reduce((a, p) => a + p.revenue, 0) ?? 0;
  const profit = t?.reduce((a, p) => a + p.profit, 0) ?? 0;
  const cogs = t?.reduce((a, p) => a + p.cogs, 0) ?? 0;
  const margin = revenue ? (profit / revenue) * 100 : 0;

  const columns: Column<TopProduct>[] = [
    { key: 'name', header: 'Product', cell: (r) => <Link href={`/products/${r.productId}`} className="font-medium hover:text-accent">{r.name}</Link> },
    { key: 'brand', header: 'Brand', cell: (r) => <span className="text-ink-2">{r.brand}</span> },
    { key: 'units', header: 'Units', align: 'right', cell: (r) => formatNumber(r.units) },
    { key: 'revenue', header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenue) },
    { key: 'profit', header: 'Profit', align: 'right', cell: (r) => <span className="font-semibold">{r.profit !== undefined ? formatMoney(r.profit) : '—'}</span> },
    { key: 'margin', header: 'Margin', align: 'right', cell: (r) => (r.marginPct !== undefined ? formatPct(r.marginPct) : '—') },
  ];

  return (
    <>
      <KpiGrid loading={trend.initial} count={3}>
        <KpiCard label="Gross profit" value={formatMoney(profit, 'EGP', { compact: true })} sub={range.label} sparkline={t?.map((p) => p.profit)} />
        <KpiCard label="Margin" value={formatPct(margin)} sub="profit ÷ revenue" />
        <KpiCard label="COGS" value={formatMoney(cogs, 'EGP', { compact: true })} sub="Cost of goods sold" />
        <KpiCard label="Revenue" value={formatMoney(revenue, 'EGP', { compact: true })} sub="for reference" />
      </KpiGrid>
      <ChartCard title="Sales & profit trend" action={<span className="flex items-center gap-3 text-xs text-ink-2"><span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-3 bg-accent" />Sales</span><span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-3 border-t-2 border-dashed border-ink-3" />Profit</span></span>} fallback={t ? trendSummary(t) : undefined}>
        {t ? (t.length ? <TrendChart data={t} showProfit /> : <EmptyState compact title="No sales in this range" />) : <ChartSkeleton />}
      </ChartCard>
      <DataTable aria-label="Top products by profit" columns={columns} rows={top.data} rowKey={(r) => r.productId} loading={top.loading} error={top.error} onRetry={() => void top.refetch()} compact
        empty={<EmptyState compact title="No profit to rank" body="Nothing was sold in this range." />}
        footer={<span className="text-ink-2">Top 10 products by profit · {range.label}</span>} />
    </>
  );
}
