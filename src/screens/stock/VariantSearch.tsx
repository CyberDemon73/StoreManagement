'use client';
/**
 * Variant picker used by Receive, Adjust and Count: a search box with a results dropdown
 * (GET /variants/search) plus the barcode scanner (GET /variants/lookup).
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { SearchInput } from '@/components/ui/Controls';
import { ColorSwatch } from '@/components/ui/Badge';
import { BarcodeScannerButton } from '@/components/app/BarcodeScanner';
import type { VariantWithProduct } from '@/types';

export function VariantSearch({ onPick, placeholder = 'Search product, SKU or scan barcode', size = 'md', scan = true, autoFocus, className, showOnHand = true }: {
  onPick: (v: VariantWithProduct) => void;
  placeholder?: string;
  size?: 'md' | 'lg';
  scan?: boolean;
  autoFocus?: boolean;
  className?: string;
  showOnHand?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q.trim(), 200);
  const results = useApi(() => api.variants.search(dq, 8), [dq], { enabled: dq.length > 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (v: VariantWithProduct) => { onPick(v); setQ(''); setOpen(false); };
  const list = dq ? results.data ?? [] : [];

  return (
    <div ref={ref} className={cn('flex items-center gap-2', className)}>
      <div className="relative min-w-0 flex-1" onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); pick(list[0]); } if (e.key === 'Escape') setOpen(false); }}>
        <SearchInput value={q} onChange={(v) => { setQ(v); setOpen(true); }} placeholder={placeholder} size={size} autoFocus={autoFocus} aria-label={placeholder} />
        {open && dq && (
          <div role="listbox" aria-label="Matching variants" className="absolute z-[60] mt-1 w-full rounded-card border border-line bg-surface p-1.5 shadow-float">
            {results.loading && !results.data ? <p className="px-3 py-2 text-sm text-ink-2">Searching…</p>
              : results.error && !results.data ? <p className="px-3 py-2 text-sm text-danger-ink">{results.error.message}</p>
              : list.length === 0 ? <p className="px-3 py-2 text-sm text-ink-2">No variant matches “{dq}”</p>
              : list.map((v) => (
                <button key={v.id} type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(v)} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-surface-2">
                  <ColorSwatch hex={v.color.hex} name={v.color.name} />
                  <span className="min-w-0 flex-1 truncate">{v.product.name} · {v.size} · {v.color.name}</span>
                  <span className="tabular hidden text-xs text-ink-2 sm:inline">{v.sku}</span>
                  {showOnHand && <span className="tabular text-xs text-ink-2">{v.quantity} on hand</span>}
                </button>
              ))}
          </div>
        )}
      </div>
      {scan && <BarcodeScannerButton onScan={pick} size={size === 'lg' ? 'lg' : 'md'} />}
    </div>
  );
}

/** Compact "selected variant" row with a swatch, used once something has been picked. */
export function VariantRow({ v, trailing, className }: { v: Pick<VariantWithProduct, 'size' | 'color' | 'sku'> & { name: string; hint?: string }; trailing?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <ColorSwatch hex={v.color.hex} name={v.color.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{v.name} · {v.size} · {v.color.name}</p>
        <p className="tabular truncate text-xs text-ink-2">{v.sku}{v.hint ? ` · ${v.hint}` : ''}</p>
      </div>
      {trailing}
    </div>
  );
}
