'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Checkbox, Segmented } from './Field';
import { Popover, MenuItem } from './Overlay';
import { EmptyState, ErrorState, SkeletonRows } from './States';
import type { ApiError } from '@/lib/api';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
  sortable?: boolean;
  /** Hide by default from the column picker. */
  hidden?: boolean;
  /** Only render when the predicate passes (e.g. role checks) — keeps alignment stable. */
  when?: boolean;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: ApiError;
  onRetry?: () => void;
  empty?: ReactNode;
  /** Row click (quick view). */
  onRowClick?: (row: T) => void;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  sort?: { key: string; desc: boolean };
  onSortChange?: (s: { key: string; desc: boolean }) => void;
  page?: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (n: number) => void };
  footer?: ReactNode;
  compact?: boolean;
  className?: string;
  /** Virtualise long static lists (simple windowing by row height). */
  virtual?: boolean;
  rowClassName?: (row: T) => string | undefined;
  'aria-label'?: string;
}

const PAGE_SIZES = ['25', '50', '100'] as const;

export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, empty, onRowClick, selectedKeys, onSelectionChange, sort, onSortChange, page, footer, compact, className, virtual, rowClassName, ...a11y }: DataTableProps<T>) {
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set(columns.filter((c) => c.hidden).map((c) => c.key)));
  const [colsOpen, setColsOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const visible = columns.filter((c) => c.when !== false && !hiddenCols.has(c.key));
  const selectable = !!onSelectionChange;
  const allSelected = !!rows && rows.length > 0 && rows.every((r) => selectedKeys?.has(rowKey(r)));
  const someSelected = !!rows && rows.some((r) => selectedKeys?.has(rowKey(r)));

  const ROW_H = compact ? 40 : 56;
  const windowed = useMemo(() => {
    if (!virtual || !rows || rows.length < 200) return { slice: rows ?? [], top: 0, bottom: 0 };
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
    const end = Math.min(rows.length, start + 60);
    return { slice: rows.slice(start, end), top: start * ROW_H, bottom: (rows.length - end) * ROW_H };
  }, [virtual, rows, scrollTop, ROW_H]);

  const toggleAll = () => { if (!rows) return; const next = new Set(selectedKeys); if (allSelected) rows.forEach((r) => next.delete(rowKey(r))); else rows.forEach((r) => next.add(rowKey(r))); onSelectionChange?.(next); };
  const toggleOne = (k: string) => { const next = new Set(selectedKeys); if (next.has(k)) next.delete(k); else next.add(k); onSelectionChange?.(next); };

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-card border border-line bg-surface', className)}>
      <div className={cn('overflow-auto', virtual && 'max-h-[70vh]')} onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}>
        <table className="w-full border-separate border-spacing-0 text-sm" aria-label={a11y['aria-label']} aria-busy={loading || undefined}>
          <thead>
            <tr>
              {selectable && <th className="sticky top-0 z-10 w-10 border-b border-line bg-surface px-3 py-2.5"><Checkbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={toggleAll} aria-label="Select all on page" /></th>}
              {visible.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" style={{ width: c.width }} className={cn('sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2', c.align === 'right' && 'text-right', c.className)} aria-sort={active ? (sort?.desc ? 'descending' : 'ascending') : undefined}>
                    {c.sortable && onSortChange ? (
                      <button type="button" className={cn('inline-flex items-center gap-1 rounded hover:text-ink', c.align === 'right' && 'flex-row-reverse')} onClick={() => onSortChange({ key: c.key, desc: active ? !sort?.desc : true })}>
                        {c.header}{active && (sort?.desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
              <th className="sticky top-0 z-10 w-8 border-b border-line bg-surface px-1 py-2.5 text-right">
                <Popover open={colsOpen} onClose={() => setColsOpen(false)} anchor={<button type="button" aria-label="Choose columns" aria-haspopup="menu" aria-expanded={colsOpen} onClick={() => setColsOpen((o) => !o)} className="rounded p-1 text-ink-2 hover:bg-surface-2 hover:text-ink"><Columns3 className="size-4" /></button>}>
                  <p className="px-3 py-1.5 text-xs font-medium text-ink-2">Columns</p>
                  {columns.filter((c) => c.when !== false).map((c) => <MenuItem key={c.key} onClick={() => setHiddenCols((s) => { const n = new Set(s); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })}><Checkbox checked={!hiddenCols.has(c.key)} label={c.header} /></MenuItem>)}
                </Popover>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows ? (
              <tr><td colSpan={visible.length + 2} className="p-3"><SkeletonRows rows={8} /></td></tr>
            ) : error && !rows ? (
              <tr><td colSpan={visible.length + 2}><ErrorState error={error} onRetry={onRetry} compact /></td></tr>
            ) : rows && rows.length === 0 ? (
              <tr><td colSpan={visible.length + 2}>{empty ?? <EmptyState title="Nothing to show" compact />}</td></tr>
            ) : (
              <>
                {windowed.top > 0 && <tr aria-hidden><td colSpan={visible.length + 2} style={{ height: windowed.top }} /></tr>}
                {windowed.slice.map((r) => {
                  const k = rowKey(r);
                  const sel = selectedKeys?.has(k);
                  return (
                    <tr key={k} className={cn('group', onRowClick && 'cursor-pointer', sel && 'bg-accent-soft/60', rowClassName?.(r))} onClick={onRowClick ? () => onRowClick(r) : undefined} aria-selected={sel}>
                      {selectable && <td className="border-b border-line px-3 group-last:border-0" onClick={(e) => e.stopPropagation()}><Checkbox checked={!!sel} onChange={() => toggleOne(k)} aria-label="Select row" /></td>}
                      {visible.map((c) => <td key={c.key} className={cn('border-b border-line px-3 align-middle group-last:border-0 group-hover:bg-surface-2/60', compact ? 'py-2' : 'py-3', c.align === 'right' && 'tabular text-right', c.className)}>{c.cell(r)}</td>)}
                      <td className="border-b border-line group-last:border-0" />
                    </tr>
                  );
                })}
                {windowed.bottom > 0 && <tr aria-hidden><td colSpan={visible.length + 2} style={{ height: windowed.bottom }} /></tr>}
              </>
            )}
          </tbody>
        </table>
      </div>
      {(page || footer) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 text-sm">
          {footer}
          {page && (
            <>
              <span className="tabular text-ink-2">{page.total === 0 ? '0 results' : `${(page.page - 1) * page.pageSize + 1}–${Math.min(page.total, page.page * page.pageSize)} of ${page.total.toLocaleString()}`}</span>
              <div className="ml-auto flex items-center gap-2">
                <span className="hidden text-xs text-ink-2 sm:inline">Rows</span>
                <Segmented size="sm" value={String(page.pageSize) as (typeof PAGE_SIZES)[number]} onChange={(v) => page.onPageSize(parseInt(v, 10))} options={PAGE_SIZES.map((p) => ({ value: p, label: p }))} aria-label="Rows per page" />
                <Button size="sm" iconOnly aria-label="Previous page" disabled={page.page <= 1} onClick={() => page.onPage(page.page - 1)}><ChevronLeft /></Button>
                <span className="tabular text-xs">{page.page} / {Math.max(1, Math.ceil(page.total / page.pageSize))}</span>
                <Button size="sm" iconOnly aria-label="Next page" disabled={page.page * page.pageSize >= page.total} onClick={() => page.onPage(page.page + 1)}><ChevronRight /></Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
