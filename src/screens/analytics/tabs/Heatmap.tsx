'use client';
/**
 * Size × colour heatmap of units sold. Cells interpolate --surface-2 → --accent (fixed light
 * values so contrast is predictable); text flips to white past t = 0.55. Each cell is an image
 * with a full-text label, and a one-sentence summary follows for screen readers and scanning.
 */
import { Fragment, useMemo } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { Chip } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/States';
import type { Brand, DateRange, SizeColorMatrix } from '@/types';
import { ChartSkeleton } from './shared';

const FROM = [241, 239, 234]; // #F1EFEA
const TO = [63, 107, 92]; // #3F6B5C
function mix(t: number): string {
  const c = FROM.map((a, i) => Math.round(a + ((TO[i] ?? a) - a) * t));
  return `rgb(${c.join(',')})`;
}

export function heatmapSummary(m: SizeColorMatrix): string {
  if (!m.cells.length || m.cells.every((c) => c.sold === 0)) return 'Nothing sold in this range.';
  const best = m.cells.reduce((a, c) => (c.sold > a.sold ? c : a));
  const bySize = m.sizes.map((s) => ({ size: s, total: m.cells.filter((c) => c.size === s).reduce((a, c) => a + c.sold, 0) }));
  const weakest = bySize.reduce((a, s) => (s.total < a.total ? s : a));
  const byColor = m.colors.map((c) => ({ name: c.name, total: m.cells.filter((x) => x.color === c.name).reduce((a, x) => a + x.sold, 0) }));
  const avg = byColor.reduce((a, c) => a + c.total, 0) / Math.max(1, byColor.length);
  const under = byColor.filter((c) => c.total < avg * 0.5).map((c) => c.name);
  return `Best cell: ${best.size} · ${best.color} (${best.sold} units). Weakest sold size: ${weakest.size} (${weakest.total} total).${under.length ? ` ${under.join(' and ')} under-perform across sizes.` : ''}`;
}

export function Heatmap({ range, brands, brandId, onBrand }: { range: DateRange; brands: Brand[] | undefined; brandId: string | undefined; onBrand: (id: string | undefined) => void }) {
  const matrix = useApi(() => api.analytics.sizeColor(brandId, range.from, range.to), [brandId, range.from, range.to]);
  const m = matrix.data;
  const max = useMemo(() => Math.max(1, ...(m?.cells.map((c) => c.sold) ?? [1])), [m]);
  const days = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000) + 1);

  return (
    <Card className="flex flex-col gap-3">
      <CardHeader title={`Size × color heatmap · units sold ${days}d`} action={
        <div className="scrollbar-none flex max-w-[360px] gap-1.5 overflow-x-auto" role="group" aria-label="Filter by brand">
          <Chip size="sm" selected={!brandId} onClick={() => onBrand(undefined)}>All brands</Chip>
          {(brands ?? []).filter((b) => b.isActive).map((b) => <Chip key={b.id} size="sm" selected={brandId === b.id} onClick={() => onBrand(b.id)}>{b.name}</Chip>)}
        </div>} />
      {matrix.error && !m ? <ErrorState compact error={matrix.error} onRetry={() => void matrix.refetch()} /> : !m ? <ChartSkeleton height={240} /> : m.sizes.length === 0 ? <EmptyState compact title="No variants to show" body={brandId ? 'This brand has no variants yet.' : 'Add products with sizes and colours first.'} /> : (
        <>
          <div className="overflow-x-auto">
            <div className="grid items-center gap-1" style={{ gridTemplateColumns: `56px repeat(${m.colors.length}, minmax(44px, 1fr))`, minWidth: 56 + m.colors.length * 48 }} role="table" aria-label="Units sold by size and colour">
              <span />
              {m.colors.map((c) => <span key={c.name} className="flex items-center justify-center gap-1 truncate text-center text-xs text-ink-2" role="columnheader"><i aria-hidden className="size-2.5 shrink-0 rounded-full border border-black/10" style={{ background: c.hex }} />{c.name}</span>)}
              {m.sizes.map((size) => (
                <Fragment key={size}>
                  <span className="text-sm font-semibold" role="rowheader">{size}</span>
                  {m.colors.map((c) => {
                    const cell = m.cells.find((x) => x.size === size && x.color === c.name);
                    const sold = cell?.sold ?? 0;
                    const t = sold / max;
                    return <div key={c.name} role="img" aria-label={`${size} ${c.name}: ${sold} units sold, ${cell?.qty ?? 0} in stock`} className="tabular flex h-10 items-center justify-center rounded-md text-[13px] font-medium" style={{ background: mix(t), color: t > 0.55 ? '#FFFFFF' : '#1F2421' }}>{sold}</div>;
                  })}
                </Fragment>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <span>Fewer</span><i aria-hidden className="h-2 w-20 rounded-full" style={{ background: `linear-gradient(90deg, ${mix(0)}, ${mix(1)})` }} /><span>More</span>
            <p className="ml-auto min-w-0 flex-1 text-right sm:flex-none">{heatmapSummary(m)}</p>
          </div>
        </>
      )}
    </Card>
  );
}
