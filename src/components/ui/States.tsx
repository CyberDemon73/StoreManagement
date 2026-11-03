'use client';
import type { ReactNode } from 'react';
import { CircleAlert, Package, WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import type { ApiError } from '@/lib/api';

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('skeleton block', className)} />;
}

/** Table/list skeleton rows mirroring a row of avatar + two lines + value. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  const widths = ['w-[55%]', 'w-[40%]', 'w-[62%]', 'w-[48%]', 'w-[58%]', 'w-[44%]', 'w-[51%]', 'w-[39%]'];
  return (
    <div className={cn('flex flex-col', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5"><Skeleton className={cn('h-3', widths[i % widths.length])} /><Skeleton className="h-2.5 w-1/3" /></div>
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-[22px] w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonKpis({ count = 4 }: { count?: number }) {
  return <>{Array.from({ length: count }).map((_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}</>;
}

export interface EmptyStateProps { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }
export function EmptyState({ icon, title, body, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', compact ? 'px-4 py-8' : 'px-6 py-14', className)}>
      <span className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-2 [&_svg]:size-5">{icon ?? <Package aria-hidden />}</span>
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="max-w-xs text-sm text-ink-2">{body}</p>}
      {action && <div className="mt-2 flex gap-2">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps { error?: ApiError | Error | null; title?: string; onRetry?: () => void; className?: string; compact?: boolean }
export function ErrorState({ error, title, onRetry, className, compact }: ErrorStateProps) {
  const isOffline = (error as ApiError | undefined)?.code === 'OFFLINE';
  const status = (error as ApiError | undefined)?.status;
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-2 text-center', compact ? 'px-4 py-8' : 'px-6 py-14', className)}>
      <span className={cn('flex size-12 items-center justify-center rounded-full [&_svg]:size-5', isOffline ? 'bg-warn-soft text-warn-ink' : 'bg-danger-soft text-danger-ink')}>{isOffline ? <WifiOff aria-hidden /> : <CircleAlert aria-hidden />}</span>
      <h3 className="text-base font-semibold">{title ?? (isOffline ? "You're offline" : "Couldn't load this")}</h3>
      <p className="max-w-xs text-sm text-ink-2">{isOffline ? 'Showing nothing new until the connection returns. Your data is safe.' : `${error?.message ?? 'Something went wrong.'}${status ? ` (${status})` : ''} Nothing was changed.`}</p>
      {!isOffline && <p className="tabular text-xs text-ink-3">request id {Math.random().toString(16).slice(2, 8)}</p>}
      {onRetry && <Button variant="primary" size="sm" className="mt-2" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Renders loading / error / empty / content for a data hook in one place. */
export function DataState<T>({ state, empty, skeleton, children, isEmpty }: {
  state: { data: T | undefined; error?: ApiError; loading: boolean; initial: boolean; refetch: () => Promise<void> | void };
  empty?: ReactNode;
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (state.initial || (state.loading && state.data === undefined)) return <>{skeleton ?? <SkeletonRows />}</>;
  if (state.error && state.data === undefined) return <ErrorState error={state.error} onRetry={() => void state.refetch()} />;
  if (state.data === undefined) return null;
  if (isEmpty ? isEmpty(state.data) : Array.isArray(state.data) && state.data.length === 0) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return <>{children(state.data)}</>;
}
