'use client';
/** Analytics · Brands tab. Calls: GET /analytics/brands. */
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatMoney, formatPct } from '@/lib/format';
import { KpiCard } from '@/components/ui/Card';
import { ChartCard, CHART_COLORS, DonutChart } from '@/components/app/Charts';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Progress } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/States';
import type { BrandSplit } from '@/types';
import { ChartSkeleton, KpiGrid, type TabProps } from './shared';

export function BrandsTab({ range }: TabProps) {
  const brands = useApi(() => api.analytics.brands(range.from, range.to), [range.from, range.to]);
  if (brands.error && !brands.data) return <ErrorState error={brands.error} onRetry={() => void brands.refetch()} />;
  const b = brands.data;
  const total = b?.reduce((a, x) => a + x.revenue, 0) ?? 0;
  const leader = b && b.length ? b.reduce((a, x) => (x.revenue > a.revenue ? x : a)) : undefined;

  const columns: Column<BrandSplit>[] = [
    { key: 'name', header: 'Brand', cell: (r) => <Link href={`/products?brandId=${r.id}`} className="font-medium hover:text-accent">{r.name}</Link> },
    { key: 'revenue', header: 'Revenue', align: 'right', cell: (r) => <span className="font-semibold">{formatMoney(r.revenue)}</span> },
    { key: 'share', header: 'Share', align: 'right', cell: (r) => formatPct(r.sharePct) },
    { key: 'bar', header: '', width: '30%', cell: (r) => <Progress value={r.sharePct} max={100} /> },
  ];

  return (
    <>
      <KpiGrid loading={brands.initial} count={3}>
        <KpiCard label="Brands with sales" value={String(b?.length ?? 0)} sub={range.label} />
        <KpiCard label="Leading brand" value={leader?.name ?? '—'} sub={leader ? `${formatPct(leader.sharePct, 0)} of revenue` : undefined} />
        <KpiCard label="Revenue" value={formatMoney(total, 'EGP', { compact: true })} sub="all brands" />
      </KpiGrid>
      <section className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Brand split" fallback={b ? b.map((x) => `${x.name} ${formatPct(x.sharePct, 0)}`).join(' · ') : undefined}>
          {b ? (b.length ? (
            <div className="flex items-center gap-5">
              <DonutChart data={b.map((x) => ({ name: x.name, value: x.revenue }))} center={{ value: String(b.length), label: 'brands' }} />
              <ul className="flex flex-1 flex-col gap-2.5">{b.map((x, i) => <li key={x.id} className="flex items-center gap-2 text-sm"><span aria-hidden className="size-3 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} /><span className="flex-1 truncate">{x.name}</span><span className="tabular text-ink-2">{formatPct(x.sharePct, 0)}</span></li>)}</ul>
            </div>
          ) : <EmptyState compact title="No sales in this range" />) : <ChartSkeleton height={140} />}
        </ChartCard>
        <DataTable className="xl:col-span-2" aria-label="Revenue by brand" columns={columns} rows={b} rowKey={(r) => r.id} loading={brands.loading} error={brands.error} onRetry={() => void brands.refetch()} compact
          empty={<EmptyState compact title="No sales in this range" body="Pick a wider date range." />} />
      </section>
    </>
  );
}
