'use client';
/**
 * Parked (held) sales. Lists GET /sales/parked with a Resume action that unparks
 * (DELETE /sales/parked/:id) and loads the cart. Sheet on mobile, Drawer otherwise.
 */
import { Bookmark } from 'lucide-react';
import { formatMoney, formatTime } from '@/lib/format';
import type { ApiState } from '@/lib/use-api';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Overlay';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import type { ParkedSale } from '@/types';

export const MAX_PARKED = 3;

export function ParkedPanel({ open, onClose, parked, onResume, resuming }: { open: boolean; onClose: () => void; parked: ApiState<ParkedSale[]>; onResume: (p: ParkedSale) => void; resuming?: string }) {
  const list = parked.data ?? [];
  return (
    <Panel open={open} onClose={onClose} title="Parked sales" description={`${list.length} of ${MAX_PARKED} slots used. Resuming replaces the current cart.`}>
      {parked.initial ? <SkeletonRows rows={3} /> : parked.error && !parked.data ? <ErrorState compact error={parked.error} onRetry={() => void parked.refetch()} /> : list.length === 0 ? (
        <EmptyState compact icon={<Bookmark aria-hidden />} title="Nothing parked" body="Use Park in the cart to hold a sale while you serve someone else." />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.map((p) => {
            const count = p.cart.lines.reduce((a, l) => a + l.qty, 0);
            const total = p.cart.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
            return (
              <li key={p.id} className="flex min-h-14 items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.label}</p>
                  <p className="tabular text-xs text-ink-2">{formatTime(p.parkedAt)} · {count} item{count === 1 ? '' : 's'} · {p.cart.lines.slice(0, 2).map((l) => l.productName).join(', ')}{p.cart.lines.length > 2 ? '…' : ''}</p>
                </div>
                <span className="tabular text-sm font-semibold">{formatMoney(total)}</span>
                <Button size="md" variant="soft" loading={resuming === p.id} onClick={() => onResume(p)}>Resume</Button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
