'use client';
/**
 * VariantMatrix — sizes as rows × colors as columns. Each cell shows quantity with ok/low/out
 * colouring (text is always present, colour is never the only signal). Tap a cell to select.
 */
import { cn } from '@/lib/cn';
import { stockStatus } from '@/lib/format';
import { ColorSwatch } from '@/components/ui/Badge';
import type { ColorRef, Variant } from '@/types';

const CELL: Record<'ok' | 'low' | 'out' | 'none', string> = {
  ok: 'bg-ok-soft text-ok-ink',
  low: 'bg-warn-soft text-warn-ink',
  out: 'bg-danger-soft text-danger-ink',
  none: 'bg-surface-2 text-ink-3',
};

export interface VariantMatrixProps {
  sizes: string[];
  colors: ColorRef[];
  variants: Variant[];
  selectedId?: string;
  onSelect?: (v: Variant) => void;
  /** Render a quantity input per cell (create flow). */
  editable?: { values: Record<string, number>; onChange: (key: string, qty: number) => void };
  cellHeight?: 'sm' | 'md' | 'lg';
  showTotals?: boolean;
  className?: string;
  /** Minimum column width — matrix scrolls horizontally on phones. */
  minCol?: number;
}

export const matrixKey = (size: string, color: string) => `${size}|${color}`;

export function VariantMatrix({ sizes, colors, variants, selectedId, onSelect, editable, cellHeight = 'md', showTotals, className, minCol = 56 }: VariantMatrixProps) {
  const byKey = new Map(variants.map((v) => [matrixKey(v.size, v.color.name), v]));
  const h = cellHeight === 'sm' ? 'h-9 text-sm' : cellHeight === 'lg' ? 'h-14 text-base' : 'h-12 text-sm';
  const colTotals = colors.map((c) => sizes.reduce((a, s) => a + (byKey.get(matrixKey(s, c.name))?.quantity ?? 0), 0));
  return (
    <div className={cn('overflow-x-auto', className)}>
      <div role="grid" aria-label="Variants by size and color" className="grid items-center gap-1.5" style={{ gridTemplateColumns: `minmax(44px,auto) repeat(${colors.length}, minmax(${minCol}px, 1fr))${showTotals ? ' minmax(56px,auto)' : ''}`, minWidth: 44 + colors.length * minCol }}>
        <span role="columnheader" className="text-[11px] text-ink-2">Size</span>
        {colors.map((c) => <span key={c.name} role="columnheader" className="flex flex-col items-center gap-1 text-[11px] text-ink-2"><ColorSwatch hex={c.hex} name={c.name} /><span className="truncate">{c.name}</span></span>)}
        {showTotals && <span role="columnheader" className="text-right text-[11px] text-ink-2">Total</span>}
        {sizes.map((s) => (
          <Row key={s} size={s} colors={colors} byKey={byKey} selectedId={selectedId} onSelect={onSelect} editable={editable} h={h} showTotals={showTotals} />
        ))}
        {showTotals && (
          <>
            <span className="text-[11px] text-ink-2">Total</span>
            {colTotals.map((t, i) => <span key={i} className="tabular text-center text-xs text-ink-2">{t}</span>)}
            <span className="tabular text-right text-xs font-semibold">{colTotals.reduce((a, b) => a + b, 0)}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ size, colors, byKey, selectedId, onSelect, editable, h, showTotals }: { size: string; colors: ColorRef[]; byKey: Map<string, Variant>; selectedId?: string; onSelect?: (v: Variant) => void; editable?: VariantMatrixProps['editable']; h: string; showTotals?: boolean }) {
  let total = 0;
  return (
    <>
      <span role="rowheader" className="text-sm font-semibold">{size}</span>
      {colors.map((c) => {
        const key = matrixKey(size, c.name);
        if (editable) {
          const val = editable.values[key] ?? 0;
          return <input key={key} type="number" min={0} inputMode="numeric" aria-label={`${size} ${c.name} initial quantity`} value={val} onChange={(e) => editable.onChange(key, Math.max(0, parseInt(e.target.value || '0', 10)))} className={cn('tabular w-full rounded-lg border border-line bg-surface text-center font-medium outline-none focus:border-accent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none', h)} />;
        }
        const v = byKey.get(key);
        if (!v) return <span key={key} role="gridcell" aria-label={`${size} ${c.name}, not a variant`} className={cn('flex items-center justify-center rounded-lg font-semibold', h, CELL.none)}>—</span>;
        total += v.quantity;
        const st = stockStatus(v.quantity, v.lowStockThreshold);
        const label = `${size} ${c.name}, ${v.quantity}${st === 'out' ? ', out of stock' : st === 'low' ? ', low' : ''}`;
        const cls = cn('tabular flex w-full items-center justify-center rounded-lg border font-semibold transition-shadow', h, CELL[st], selectedId === v.id ? 'border-accent ring-2 ring-accent-soft' : 'border-transparent', onSelect && 'hover:ring-2 hover:ring-accent-soft');
        return onSelect ? <button key={key} type="button" role="gridcell" aria-label={label} aria-selected={selectedId === v.id} onClick={() => onSelect(v)} className={cls}>{v.quantity}</button> : <span key={key} role="gridcell" aria-label={label} className={cls}>{v.quantity}</span>;
      })}
      {showTotals && <span className="tabular text-right text-sm text-ink-2">{total}</span>}
    </>
  );
}

export function MatrixLegend({ threshold }: { threshold?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-2">
      <span className="flex items-center gap-1.5"><i className={cn('size-3.5 rounded', CELL.ok)} />OK</span>
      <span className="flex items-center gap-1.5"><i className={cn('size-3.5 rounded', CELL.low)} />Low{threshold !== undefined && ` (≤ ${threshold})`}</span>
      <span className="flex items-center gap-1.5"><i className={cn('size-3.5 rounded', CELL.out)} />Out</span>
      <span className="flex items-center gap-1.5"><i className={cn('size-3.5 rounded', CELL.none)} />Not a variant</span>
    </div>
  );
}
