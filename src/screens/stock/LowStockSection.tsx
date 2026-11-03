'use client';
/** One grouped section of /stock/low (Out · n or Low · n): table on tablet+, cards on mobile. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useBreakpoint } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { stockStatus } from '@/lib/format';
import { LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox, Input } from '@/components/ui/Field';
import { ColorSwatch, StockBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/States';
import type { VariantWithProduct } from '@/types';

export interface LowRow { v: VariantWithProduct; sold30: number | undefined; daysOut: number | undefined }

const TH = 'whitespace-nowrap border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2';
const TD = 'border-b border-line px-3 py-2.5 align-middle group-last:border-0';

export function LowStockSection({ kind, rows, selected, onToggle, canAct, showActions, onThreshold, soldLoading, brandFilter }: {
  kind: 'out' | 'low';
  rows: LowRow[];
  selected: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  /** Can receive stock (checkboxes + Receive buttons). */
  canAct: boolean;
  /** Manager view: threshold editing, sold figures, Open links. */
  showActions: boolean;
  onThreshold: (v: VariantWithProduct, next: number) => void;
  soldLoading: boolean;
  brandFilter?: string;
}) {
  const bp = useBreakpoint();
  const isOut = kind === 'out';
  const title = `${isOut ? 'Out of stock' : 'Low stock'} · ${rows.length}`;
  const headCls = isOut ? 'bg-danger-soft text-danger-ink' : 'bg-warn-soft text-warn-ink';
  const empty = <EmptyState compact title={isOut ? 'Nothing is out of stock' : 'Nothing is low'} body={brandFilter ? `No ${isOut ? 'out-of-stock' : 'low'} variants for ${brandFilter}.` : isOut ? 'Every active variant has at least one unit.' : 'Every variant is above its threshold.'} />;

  const daysLeft = (r: LowRow) => {
    if (r.sold30 === undefined) return soldLoading ? <span className="skeleton inline-block h-3 w-12" /> : '—';
    if (r.sold30 === 0) return <span className="text-ink-2">no sales 30d</span>;
    const d = Math.round(r.v.quantity / (r.sold30 / 30));
    return <span className={cn(d <= 2 ? 'text-danger-ink' : d <= 7 ? 'text-warn-ink' : 'text-ink-2')}>~{d} day{d === 1 ? '' : 's'}</span>;
  };
  const outSince = (r: LowRow) => r.daysOut === undefined ? <span className="text-ink-2">—</span> : <span className="text-ink-2">{r.daysOut} day{r.daysOut === 1 ? '' : 's'}</span>;
  const sold = (r: LowRow) => r.sold30 === undefined ? (soldLoading ? <span className="skeleton inline-block h-3 w-6" /> : '—') : r.sold30;
  const actions = (r: LowRow) => (
    <div className="flex justify-end gap-1.5">
      {canAct && <LinkButton size="sm" variant="primary" href={`/stock/receive?variantId=${r.v.id}`}>Receive</LinkButton>}
      <LinkButton size="sm" href={`/products/${r.v.productId}`}>Open</LinkButton>
    </div>
  );

  return (
    <Card as="section" padded={false} aria-label={title} className="overflow-hidden">
      <div className={cn('flex items-center justify-between px-4 py-3', headCls)}>
        <h2 className="text-sm font-semibold">{title}</h2>
        {!isOut && showActions && <span className="hidden text-xs md:inline">Threshold editable inline · saves on blur</span>}
      </div>
      {rows.length === 0 ? empty : bp === 'mobile' ? (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.v.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-start gap-3">
                {canAct && <Checkbox checked={selected.has(r.v.id)} onChange={(on) => onToggle(r.v.id, on)} aria-label={`Select ${r.v.sku}`} className="mt-1" />}
                <ColorSwatch hex={r.v.color.hex} name={r.v.color.name} className="mt-1.5" />
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">{r.v.product.name} · {r.v.size} · {r.v.color.name}</p><p className="tabular text-xs text-ink-2">{r.v.sku} · {r.v.product.brandName}</p></div>
                <StockBadge status={stockStatus(r.v.quantity, r.v.lowStockThreshold)} qty={r.v.quantity} />
              </div>
              {showActions && (
                <div className="flex flex-wrap items-center gap-3 pl-8 text-xs text-ink-2">
                  <span className="flex items-center gap-1.5">Threshold <ThresholdInput v={r.v} onSave={onThreshold} /></span>
                  <span>Sold 30d <span className="tabular text-ink">{sold(r)}</span></span>
                  <span>{isOut ? <>Out <span className="tabular">{outSince(r)}</span></> : <>Left {daysLeft(r)}</>}</span>
                  <span className="ml-auto">{actions(r)}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead><tr>
              {canAct && <th scope="col" className={`${TH} w-10`}><span className="sr-only">Select</span></th>}
              <th scope="col" className={TH}>Variant</th>
              <th scope="col" className={`${TH} text-right`}>Qty</th>
              {showActions && <th scope="col" className={`${TH} text-right`}>Threshold</th>}
              {showActions && <th scope="col" className={`${TH} text-right`}>Sold 30d</th>}
              {showActions && <th scope="col" className={TH}>{isOut ? 'Out since' : 'Days left'}</th>}
              {showActions && <th scope="col" className={`${TH} w-[200px] text-right`}>Actions</th>}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.v.id} className={cn('group', selected.has(r.v.id) && 'bg-accent-soft/60')}>
                  {canAct && <td className={TD}><Checkbox checked={selected.has(r.v.id)} onChange={(on) => onToggle(r.v.id, on)} aria-label={`Select ${r.v.sku}`} /></td>}
                  <td className={TD}>
                    <div className="flex items-center gap-2.5"><ColorSwatch hex={r.v.color.hex} name={r.v.color.name} /><div className="min-w-0"><Link href={`/products/${r.v.productId}`} className="block truncate text-sm font-medium hover:text-accent">{r.v.product.name} · {r.v.size} · {r.v.color.name}</Link><p className="tabular text-xs text-ink-2">{r.v.sku} · {r.v.product.brandName}</p></div></div>
                  </td>
                  <td className={`${TD} text-right`}><StockBadge status={stockStatus(r.v.quantity, r.v.lowStockThreshold)} qty={r.v.quantity} /></td>
                  {showActions && <td className={`${TD} text-right`}><div className="flex justify-end"><ThresholdInput v={r.v} onSave={onThreshold} /></div></td>}
                  {showActions && <td className={`${TD} tabular text-right`}>{sold(r)}</td>}
                  {showActions && <td className={`${TD} tabular text-sm`}>{isOut ? outSince(r) : daysLeft(r)}</td>}
                  {showActions && <td className={`${TD} text-right`}>{actions(r)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ThresholdInput({ v, onSave }: { v: VariantWithProduct; onSave: (v: VariantWithProduct, next: number) => void }) {
  const [text, setText] = useState(String(v.lowStockThreshold));
  useEffect(() => { setText(String(v.lowStockThreshold)); }, [v.lowStockThreshold]);
  const commit = () => { const n = parseInt(text, 10); if (!Number.isFinite(n) || n < 0) { setText(String(v.lowStockThreshold)); return; } if (n !== v.lowStockThreshold) onSave(v, n); };
  return (
    <Input size="sm" type="number" inputMode="numeric" min={0} align="center" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(String(v.lowStockThreshold)); }}
      wrapperClassName="w-[68px]" aria-label={`Low stock threshold for ${v.sku}`} />
  );
}
