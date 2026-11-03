'use client';
/** Analytics · Inventory tab. Calls: GET /analytics/categories, /analytics/size-color?brandId, /analytics/slow-movers?days, GET /brands (chip filter). */
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatMoney, formatNumber, formatPct } from '@/lib/format';
import { KpiCard } from '@/components/ui/Card';
import { BarsChart, ChartCard, CHART_COLORS } from '@/components/app/Charts';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, ErrorState } from '@/components/ui/States';
import type { CategoryStats } from '@/types';
import { ChartSkeleton, KpiGrid, rangeDays, type TabProps } from './shared';
import { Heatmap } from './Heatmap';
import { SlowMoversTable, useSlowMovers } from './SlowMovers';

export function InventoryTab({ range }: TabProps) {
  const cats = useApi(() => api.analytics.categories(range.from, range.to), [range.from, range.to]);
  const brands = useApi(() => api.catalog.brands(), []);
  const [brandId, setBrandId] = useState<string>();
  const [days, setDays] = useState<60 | 90>(60);
  const slow = useSlowMovers(days);

  if (cats.error && !cats.data) return <ErrorState error={cats.error} onRetry={() => void cats.refetch()} />;
  const c = cats.data;
  const stockValue = c?.reduce((a, x) => a + x.stockValueCost, 0) ?? 0;
  const unitsInStock = c?.reduce((a, x) => a + x.unitsInStock, 0) ?? 0;
  const unitsSold = c?.reduce((a, x) => a + x.unitsSold, 0) ?? 0;
  const sellThrough = unitsInStock + unitsSold ? (unitsSold / (unitsInStock + unitsSold)) * 100 : 0;
  const nDays = rangeDays(range);
  const cover = unitsSold ? Math.round(unitsInStock / (unitsSold / nDays)) : undefined;
  const slowValue = slow.data?.reduce((a, r) => a + r.valueAtCost, 0) ?? 0;

  const columns: Column<CategoryStats>[] = [
    { key: 'name', header: 'Category', cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'stock', header: 'Stock', align: 'right', cell: (r) => formatNumber(r.unitsInStock) },
    { key: 'sold', header: 'Sold', align: 'right', cell: (r) => formatNumber(r.unitsSold) },
    { key: 'value', header: 'Value at cost', align: 'right', cell: (r) => formatMoney(r.stockValueCost) },
    { key: 'cover', header: 'Cover', align: 'right', cell: (r) => (Number.isFinite(r.daysOfCover) ? `${Math.round(r.daysOfCover)} d` : '—') },
  ];

  return (
    <>
      <KpiGrid loading={cats.initial}>
        <KpiCard label="Stock value at cost" value={formatMoney(stockValue, 'EGP', { compact: true })} sub={`${formatNumber(unitsInStock)} units · ${c?.length ?? 0} categories`} />
        <KpiCard label={`Sell-through ${nDays}d`} value={formatPct(sellThrough)} sub="sold ÷ (sold + in stock)" />
        <KpiCard label="Slow movers" value={slow.data ? formatNumber(slow.data.length) : '…'} unit="variants" sub={slow.data ? `${formatMoney(slowValue, 'EGP', { withCurrency: true, compact: true })} tied up · ${days}+ days` : undefined} />
        <KpiCard label="Days of cover" value={cover !== undefined ? String(cover) : '—'} sub="at current sales rate" />
      </KpiGrid>
      <section className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3"><Heatmap range={range} brands={brands.data} brandId={brandId} onBrand={setBrandId} /></div>
        <ChartCard className="xl:col-span-2" title="Stock vs sales by category" action={<span className="flex items-center gap-3 text-xs text-ink-2"><span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm" style={{ background: CHART_COLORS[2] }} />In stock</span><span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-accent" />Sold {nDays}d</span></span>}
          fallback={c ? c.map((x) => `${x.name} ${x.unitsInStock}/${x.unitsSold}`).join(' · ') : undefined}>
          {c ? (c.length ? (
            <>
              <BarsChart data={c.map((x) => ({ name: x.name, stock: x.unitsInStock, sold: x.unitsSold }))} xKey="name" series={[{ key: 'stock', label: 'In stock', color: CHART_COLORS[2] }, { key: 'sold', label: `Sold ${nDays}d`, color: 'var(--accent)' }]} height={200} />
              <DataTable className="mt-3" aria-label="Categories" columns={columns} rows={c} rowKey={(r) => r.id} compact />
            </>
          ) : <EmptyState compact title="No categories with stock" />) : <ChartSkeleton height={200} />}
        </ChartCard>
      </section>
      <SlowMoversTable days={days} onDays={setDays} state={slow} />
    </>
  );
}
