import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatPct } from '@/lib/format';

export function Card({ className, children, padded = true, as: Tag = 'div', ...rest }: { className?: string; children: ReactNode; padded?: boolean; as?: 'div' | 'section' | 'article' | 'aside' } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn('rounded-card border border-line bg-surface', padded && 'p-4 md:p-5', className)} {...rest}>{children}</Tag>;
}

export function CardHeader({ title, description, action, className, id }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0"><h2 id={id} className="text-[15px] font-semibold">{title}</h2>{description && <p className="mt-0.5 text-xs text-ink-2">{description}</p>}</div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  /** Percent delta vs previous period. */
  delta?: number;
  deltaLabel?: string;
  /** When true a lower number is good (returns, COGS). */
  invert?: boolean;
  sub?: ReactNode;
  sparkline?: number[];
  loading?: boolean;
  className?: string;
  compact?: boolean;
}
export function KpiCard({ label, value, unit, delta, deltaLabel, invert, sub, sparkline, loading, className, compact }: KpiCardProps) {
  const good = delta === undefined ? undefined : invert ? delta <= 0 : delta >= 0;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5 rounded-card border border-line bg-surface', compact ? 'px-3.5 py-3' : 'px-4 py-4 md:px-[18px]', className)}>
      <p className="eyebrow truncate" title={label}>{label}</p>
      {loading ? <span className="skeleton h-7 w-2/3" /> : (
        <p className={cn('tabular font-semibold leading-none tracking-[-0.02em]', compact ? 'text-xl' : 'text-[26px]')}>{value}{unit && <span className="ml-1.5 text-sm font-medium text-ink-2">{unit}</span>}</p>
      )}
      {delta !== undefined && !loading && (
        <p className={cn('inline-flex items-center gap-1 text-xs font-medium', good ? 'text-ok-ink' : 'text-danger-ink')}>
          {delta >= 0 ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
          {formatPct(delta, 1, true)}{deltaLabel && <span className="font-normal text-ink-2"> {deltaLabel}</span>}
        </p>
      )}
      {sub && !loading && <div className="text-xs text-ink-2">{sub}</div>}
      {sparkline && sparkline.length > 1 && !loading && <Sparkline data={sparkline} />}
    </div>
  );
}

export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 120},${26 - (v / max) * 22}`).join(' ');
  return <svg viewBox="0 0 120 28" preserveAspectRatio="none" className={cn('mt-1 h-7 w-full', className)} aria-hidden><polyline fill="none" stroke="var(--accent)" strokeWidth="1.5" points={pts} /></svg>;
}

export function Progress({ value, max = 100, className, tone = 'accent' }: { value: number; max?: number; className?: string; tone?: 'accent' | 'warn' | 'danger' }) {
  const pctv = Math.min(100, Math.max(0, (value / max) * 100));
  const color = tone === 'warn' ? 'bg-warn' : tone === 'danger' ? 'bg-danger' : 'bg-accent';
  return <div className={cn('h-1.5 overflow-hidden rounded-full bg-surface-2', className)} role="progressbar" aria-valuenow={value} aria-valuemax={max}><div className={cn('h-full rounded-full', color)} style={{ width: `${pctv}%` }} /></div>;
}

export function Divider({ className }: { className?: string }) { return <div className={cn('h-px w-full bg-line', className)} />; }

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) { return <p className={cn('eyebrow', className)}>{children}</p>; }
