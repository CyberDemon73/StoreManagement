'use client';
/** Phase 3 of /stock/count: variance review table (desktop) / cards (mobile) with inline counted edits. */
import { useBreakpoint } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { formatMoney, REASON_LABEL } from '@/lib/format';
import { Badge, Chip, ColorSwatch } from '@/components/ui/Badge';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/States';
import { deltaClass, REASONS, signedQty, variantTitle } from './stock-utils';
import type { AdjustmentReason, StockCountItem } from '@/types';

export interface ReviewRow extends StockCountItem {
  /** Effective counted value (null = uncounted, kept as system). */
  counted: number | null;
  variance: number | null;
  value: number | undefined;
  flagged: boolean;
}

export const LARGE_VARIANCE = 5;
const TH = 'whitespace-nowrap border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2';
const TD = 'border-b border-line px-3 py-2 align-middle group-last:border-0';

export function CountReview({ rows, allCount, filter, onFilter, reasons, onReason, onCounted, showValue }: {
  rows: ReviewRow[];
  allCount: number;
  filter: 'diff' | 'all';
  onFilter: (f: 'diff' | 'all') => void;
  reasons: Record<string, AdjustmentReason>;
  onReason: (variantId: string, r: AdjustmentReason) => void;
  onCounted: (variantId: string, qty: number | null) => void;
  showValue: boolean;
}) {
  const bp = useBreakpoint();
  const diffCount = rows.filter((r) => r.variance !== null && r.variance !== 0).length;
  const visible = filter === 'diff' ? rows.filter((r) => r.variance !== null && r.variance !== 0) : rows;

  const varianceBadge = (r: ReviewRow) => r.variance === null ? <Badge>uncounted</Badge> : <Badge tone={r.flagged ? 'warn' : r.variance > 0 ? 'ok' : r.variance < 0 ? 'danger' : 'neutral'}>{signedQty(r.variance)}</Badge>;
  const countedInput = (r: ReviewRow) => (
    <Input size="sm" type="number" inputMode="numeric" min={0} align="center" value={r.countedQty ?? ''} placeholder="—" wrapperClassName="w-[76px]" aria-label={`Counted quantity for ${r.variant.sku}`}
      onChange={(e) => { const n = parseInt(e.target.value, 10); onCounted(r.variantId, Number.isFinite(n) && n >= 0 ? n : null); }} />
  );
  const reasonCell = (r: ReviewRow) => {
    if (r.variance === null) return <span className="text-xs text-ink-2">kept as system</span>;
    if (r.variance === 0) return <span className="text-xs text-ink-2">—</span>;
    if (r.flagged) return <span className="text-xs text-warn-ink">Large variance · recount suggested</span>;
    const opts = r.variance > 0 ? REASONS.filter((x) => x === 'FOUND' || x === 'CORRECTION' || x === 'OTHER') : REASONS.filter((x) => x !== 'FOUND');
    return <Select size="sm" aria-label={`Reason for ${r.variant.sku}`} value={reasons[r.variantId] ?? (r.variance > 0 ? 'FOUND' : 'LOST')} onChange={(e) => onReason(r.variantId, e.target.value as AdjustmentReason)}>{opts.map((x) => <option key={x} value={x}>{REASON_LABEL[x]}</option>)}</Select>;
  };
  const valueCell = (r: ReviewRow) => r.value === undefined ? <span className="text-ink-2">—</span> : <span className={cn('tabular', r.variance ? deltaClass(r.variance) : 'text-ink-2')}>{formatMoney(r.value, 'EGP', { signed: true })}</span>;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 md:px-5">
        <h2 className="flex-1 text-[15px] font-semibold">3 · Variance review</h2>
        <Chip selected={filter === 'diff'} onClick={() => onFilter('diff')}>Differences only · {diffCount}</Chip>
        <Chip selected={filter === 'all'} onClick={() => onFilter('all')}>All {allCount}</Chip>
      </div>
      {visible.length === 0 ? <EmptyState compact title={filter === 'diff' ? 'No differences yet' : 'No variants in this count'} body={filter === 'diff' ? 'Counted quantities match the system so far. Switch to All to edit any row.' : 'The count scope has no active variants.'} /> : bp === 'mobile' ? (
        <ul className="flex flex-col divide-y divide-line">
          {visible.map((r) => (
            <li key={r.variantId} className={cn('flex flex-col gap-2 px-4 py-3', r.flagged && 'bg-warn-soft')}>
              <div className="flex items-center gap-2.5"><ColorSwatch hex={r.variant.color.hex} name={r.variant.color.name} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{variantTitle(r.variant.productName, r.variant.size, r.variant.color.name)}</p><p className="tabular text-xs text-ink-2">{r.variant.sku}{r.countedBy ? ` · ${r.countedBy.split(' ')[0]}` : ''}</p></div>{varianceBadge(r)}</div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-2"><span>System <span className="tabular text-ink">{r.systemQty}</span></span><span className="flex items-center gap-1.5">Counted {countedInput(r)}</span>{showValue && <span>{valueCell(r)}</span>}<span className="ml-auto min-w-0">{reasonCell(r)}</span></div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm" aria-label="Variance review">
            <thead><tr><th scope="col" className={TH}>Variant</th><th scope="col" className={`${TH} text-right`}>System</th><th scope="col" className={`${TH} text-right`}>Counted</th><th scope="col" className={`${TH} text-right`}>Variance</th>{showValue && <th scope="col" className={`${TH} text-right`}>Value Δ</th>}<th scope="col" className={TH}>Counted by</th><th scope="col" className={`${TH} w-[220px]`}>Reason</th></tr></thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.variantId} className={cn('group', r.flagged && 'bg-warn-soft')}>
                  <td className={TD}><div className="flex items-center gap-2.5"><ColorSwatch hex={r.variant.color.hex} name={r.variant.color.name} /><div className="min-w-0"><p className="truncate text-sm font-medium">{variantTitle(r.variant.productName, r.variant.size, r.variant.color.name)}</p><p className="tabular text-xs text-ink-2">{r.variant.sku}</p></div></div></td>
                  <td className={`${TD} tabular text-right text-ink-2`}>{r.systemQty}</td>
                  <td className={`${TD} text-right`}><div className="flex justify-end">{countedInput(r)}</div></td>
                  <td className={`${TD} text-right`}>{varianceBadge(r)}</td>
                  {showValue && <td className={`${TD} text-right`}>{valueCell(r)}</td>}
                  <td className={`${TD} text-xs text-ink-2`}>{r.countedBy?.split(' ')[0] ?? '—'}</td>
                  <td className={TD}>{reasonCell(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
