'use client';
/** Lines table (desktop/tablet) and line cards (mobile) for the Receive screen. */
import { X } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { MoneyInput } from '@/components/ui/Field';
import { QuantityInput } from '@/components/ui/Controls';
import { ColorSwatch } from '@/components/ui/Badge';
import type { VariantWithProduct } from '@/types';

export interface ReceiveLine { variant: VariantWithProduct; qty: number; unitCost: number }

/** Weighted average after receiving: round((onHand × oldCost + qty × unitCost) ÷ (onHand + qty)). */
export function newAvgCost(l: ReceiveLine): number {
  const onHand = Math.max(0, l.variant.quantity);
  const prev = l.variant.costPrice ?? l.unitCost;
  const denom = onHand + l.qty;
  return denom === 0 ? l.unitCost : Math.round((onHand * prev + l.qty * l.unitCost) / denom);
}

interface LinesProps {
  lines: ReceiveLine[];
  onChange: (index: number, patch: Partial<Pick<ReceiveLine, 'qty' | 'unitCost'>>) => void;
  onRemove: (index: number) => void;
  showCost: boolean;
}

const TH = 'whitespace-nowrap border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2';

export function ReceiveLinesTable({ lines, onChange, onRemove, showCost }: LinesProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm" aria-label="Purchase lines">
        <thead><tr>
          <th scope="col" className={TH}>Variant</th>
          <th scope="col" className={`${TH} text-right`}>On hand</th>
          <th scope="col" className={TH}>Qty received</th>
          {showCost && <th scope="col" className={`${TH} text-right`}>Unit cost</th>}
          {showCost && <th scope="col" className={`${TH} text-right`}>Line total</th>}
          {showCost && <th scope="col" className={`${TH} text-right`}>New avg cost</th>}
          <th scope="col" className={`${TH} w-10`}><span className="sr-only">Remove</span></th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.variant.id} className="group">
              <td className="border-b border-line px-3 py-2.5 group-last:border-0">
                <div className="flex items-center gap-2.5">
                  <ColorSwatch hex={l.variant.color.hex} name={l.variant.color.name} />
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{l.variant.product.name} · {l.variant.size} · {l.variant.color.name}</p><p className="tabular text-xs text-ink-2">{l.variant.sku}</p></div>
                </div>
              </td>
              <td className="tabular border-b border-line px-3 py-2.5 text-right text-ink-2 group-last:border-0">{l.variant.quantity}</td>
              <td className="border-b border-line px-3 py-2.5 group-last:border-0"><QuantityInput size="sm" value={l.qty} min={1} onChange={(q) => onChange(i, { qty: q })} aria-label={`Quantity received for ${l.variant.sku}`} /></td>
              {showCost && <td className="border-b border-line px-3 py-2.5 text-right group-last:border-0"><MoneyInput size="sm" value={l.unitCost} onChange={(m) => onChange(i, { unitCost: m ?? 0 })} wrapperClassName="ml-auto w-[130px]" aria-label={`Unit cost for ${l.variant.sku}`} /></td>}
              {showCost && <td className="tabular border-b border-line px-3 py-2.5 text-right font-semibold group-last:border-0">{formatMoney(l.qty * l.unitCost)}</td>}
              {showCost && <td className="tabular border-b border-line px-3 py-2.5 text-right text-ink-2 group-last:border-0">{formatMoney(newAvgCost(l))}</td>}
              <td className="border-b border-line px-1 py-2.5 text-right group-last:border-0"><Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${l.variant.sku}`} onClick={() => onRemove(i)}><X /></Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReceiveLineCards({ lines, onChange, onRemove, showCost }: LinesProps) {
  return (
    <ul className="flex flex-col divide-y divide-line" aria-label="Purchase lines">
      {lines.map((l, i) => (
        <li key={l.variant.id} className="flex flex-col gap-3 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <ColorSwatch hex={l.variant.color.hex} name={l.variant.color.name} className="mt-1" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{l.variant.product.name} · {l.variant.size} · {l.variant.color.name}</p><p className="tabular text-xs text-ink-2">{l.variant.sku} · {l.variant.quantity} on hand</p></div>
            <Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${l.variant.sku}`} onClick={() => onRemove(i)}><X /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <QuantityInput value={l.qty} min={1} onChange={(q) => onChange(i, { qty: q })} aria-label={`Quantity received for ${l.variant.sku}`} />
            {showCost && <MoneyInput value={l.unitCost} onChange={(m) => onChange(i, { unitCost: m ?? 0 })} wrapperClassName="w-[150px]" aria-label={`Unit cost for ${l.variant.sku}`} />}
            {showCost && <span className="tabular ml-auto text-sm font-semibold">{formatMoney(l.qty * l.unitCost)}</span>}
          </div>
          {showCost && <p className="tabular text-xs text-ink-2">New avg cost {formatMoney(newAvgCost(l))}</p>}
        </li>
      ))}
    </ul>
  );
}
