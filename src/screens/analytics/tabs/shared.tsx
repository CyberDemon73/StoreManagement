'use client';
/** Shared bits for the analytics tabs: props, KPI grid, chart skeletons, CSV download. */
import type { ReactNode } from 'react';
import { SkeletonKpis } from '@/components/ui/States';
import type { DateRange } from '@/types';

export interface TabProps { range: DateRange }

/** Number of calendar days in the range (inclusive), never below 1. */
export function rangeDays(range: DateRange): number {
  const ms = new Date(range.to).getTime() - new Date(range.from).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export function KpiGrid({ children, loading, count = 4 }: { children: ReactNode; loading?: boolean; count?: number }) {
  return <section aria-label="Key figures" className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">{loading ? <SkeletonKpis count={count} /> : children}</section>;
}

export function ChartSkeleton({ height = 180 }: { height?: number }) {
  return <div className="skeleton rounded-lg" style={{ height }} aria-hidden />;
}

/** Trigger a browser download for a data: or blob: URL. */
export function downloadUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Build a data URL from rows for small client-side CSVs (templates, audit export). */
export function csvDataUrl(rows: (string | number)[][]): string {
  const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.map((r) => r.map(esc).join(',')).join('\n'));
}
