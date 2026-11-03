'use client';
/** Slow movers table (GET /analytics/slow-movers?days). Days since last sale is coloured by age; the badge carries the suggestion. */
import { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { formatMoney, formatNumber } from '@/lib/format';
import { Badge, Chip, ColorSwatch, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/States';
import type { SlowMover } from '@/types';
import { downloadUrl } from './shared';

const SUGGESTION_TONE: Record<string, Tone> = { 'Markdown 20%': 'warn', Bundle: 'neutral', 'Move to front': 'neutral', Watch: 'neutral' };

export function useSlowMovers(days: 60 | 90) {
  return useApi(() => api.analytics.slowMovers(days), [days]);
}

export function SlowMoversTable({ days, onDays, state }: { days: 60 | 90; onDays: (d: 60 | 90) => void; state: ReturnType<typeof useSlowMovers> }) {
  const [exporting, setExporting] = useState(false);
  const rows = state.data;
  const value = rows?.reduce((a, r) => a + r.valueAtCost, 0) ?? 0;

  const columns: Column<SlowMover>[] = [
    { key: 'variant', header: 'Variant', cell: (r) => <span className="flex items-center gap-2.5"><ColorSwatch hex={r.color.hex} name={r.color.name} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{r.productName} · {r.size} · {r.color.name}</span><span className="tabular block text-xs text-ink-2">{r.sku}</span></span></span> },
    { key: 'brand', header: 'Brand', cell: (r) => <span className="text-ink-2">{r.brand}</span> },
    { key: 'qty', header: 'On hand', align: 'right', cell: (r) => formatNumber(r.qty) },
    { key: 'days', header: 'Days since last sale', align: 'right', cell: (r) => <span className={cn('font-medium', r.daysSinceLastSale > 90 ? 'text-danger-ink' : r.daysSinceLastSale > 60 ? 'text-warn-ink' : undefined)}>{r.daysSinceLastSale}</span> },
    { key: 'value', header: 'Value at cost', align: 'right', cell: (r) => <span className="font-semibold">{formatMoney(r.valueAtCost)}</span> },
    { key: 'sold90', header: 'Sold 90d', align: 'right', cell: (r) => formatNumber(r.soldLast90d) },
    { key: 'suggestion', header: 'Suggested', cell: (r) => <Badge tone={SUGGESTION_TONE[r.suggestion] ?? 'neutral'}>{r.suggestion}</Badge> },
  ];

  const exportCsv = async () => {
    setExporting(true);
    try { downloadUrl(await api.analytics.exportCsv('slow-movers', String(days), ''), `slow-movers-${days}d.csv`); } finally { setExporting(false); }
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="slow-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="slow-h" className="text-[15px] font-semibold">Slow movers</h2>
        <div className="ml-auto flex gap-1.5" role="group" aria-label="Minimum days without a sale">
          <Chip size="sm" selected={days === 60} onClick={() => onDays(60)}>60+ days</Chip>
          <Chip size="sm" selected={days === 90} onClick={() => onDays(90)}>90+ days</Chip>
        </div>
      </div>
      <DataTable aria-label="Slow movers" columns={columns} rows={rows} rowKey={(r) => r.variantId} loading={state.loading} error={state.error} onRetry={() => void state.refetch()}
        empty={<EmptyState compact title={`Nothing unsold for ${days}+ days`} body="Every variant in stock has sold recently." />}
        footer={<><span className="text-ink-2">{rows ? `${rows.length} variants · ${formatMoney(value, 'EGP', { withCurrency: true })} tied up` : '…'}</span><Button size="sm" className="ml-auto" leading={<Download />} loading={exporting} onClick={() => void exportCsv()}>Export</Button></>} />
    </section>
  );
}
