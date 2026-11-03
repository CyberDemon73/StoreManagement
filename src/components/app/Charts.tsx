'use client';
/**
 * Chart wrappers around recharts using the design tokens. Every chart renders a plain-text
 * summary (`fallback`) under it for screen readers and quick scanning; recharts is loaded
 * lazily so the dashboard shell paints first.
 */
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/States';
import { formatMoney } from '@/lib/format';
import type { TrendPoint } from '@/types';

const Loading = () => <Skeleton className="h-[180px] w-full rounded-lg" />;
const TrendChartImpl = dynamic(() => import('./charts/TrendChart').then((m) => m.TrendChart), { ssr: false, loading: Loading });
const DonutChartImpl = dynamic(() => import('./charts/DonutChart').then((m) => m.DonutChart), { ssr: false, loading: Loading });
const BarsChartImpl = dynamic(() => import('./charts/BarsChart').then((m) => m.BarsChart), { ssr: false, loading: Loading });

export function ChartCard({ title, description, action, children, fallback, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; fallback?: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} action={action} />
      <div className="mt-3">{children}</div>
      {fallback && <p className="mt-2 text-xs text-ink-2">{fallback}</p>}
    </Card>
  );
}

export function TrendChart(props: { data: TrendPoint[]; height?: number; showProfit?: boolean }) { return <TrendChartImpl {...props} />; }
export function DonutChart(props: { data: { name: string; value: number }[]; height?: number; center?: { value: string; label: string } }) { return <DonutChartImpl {...props} />; }
export function BarsChart(props: { data: Record<string, string | number>[]; xKey: string; series: { key: string; label: string; color?: string }[]; height?: number; money?: boolean; layout?: 'horizontal' | 'vertical' }) { return <BarsChartImpl {...props} />; }

/** Plain-number fallback for a trend. */
export function trendSummary(points: TrendPoint[]): string {
  if (!points.length) return 'No sales in this range.';
  const peak = points.reduce((a, b) => (b.revenue > a.revenue ? b : a));
  const low = points.filter((p) => p.count > 0).reduce((a, b) => (b.revenue < a.revenue ? b : a), peak);
  const fmt = (b: string) => new Date(b).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `Peak ${fmt(peak.bucket)}: sales ${formatMoney(peak.revenue, 'EGP', { withCurrency: true, compact: true })}, profit ${formatMoney(peak.profit, 'EGP', { withCurrency: true, compact: true })}. Lowest ${fmt(low.bucket)}: ${formatMoney(low.revenue, 'EGP', { withCurrency: true, compact: true })}.`;
}

export const CHART_COLORS = ['var(--accent)', '#8FB3A4', '#C9D8D0', '#5B6A8A', '#B89AA6', '#C8B89A'];
