'use client';
/**
 * GlobalSearch (⌘K) — products, SKUs/barcodes, sale numbers and (managers only) users.
 * Calls GET /products?q, GET /variants/lookup, GET /sales?q, GET /users.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Receipt, ScanLine, Search, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApi, useDebounced } from '@/lib/use-api';
import { formatMoney, formatTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, Kbd, StockBadge, Thumb } from '@/components/ui/Badge';
import { Chip } from '@/components/ui/Badge';
import { stockStatus } from '@/lib/format';

type Scope = 'all' | 'products' | 'skus' | 'sales' | 'users';

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [cursor, setCursor] = useState(0);
  const dq = useDebounced(q, 200);
  const auth = useAuth();
  const router = useRouter();
  const canUsers = auth.can('users.manage');
  const started = performance.now();

  const products = useApi(() => api.products.list({ q: dq, pageSize: 5, status: 'ALL' }), [dq], { enabled: open && dq.length > 0 && (scope === 'all' || scope === 'products') });
  const skus = useApi(() => api.variants.search(dq, 5), [dq], { enabled: open && dq.length > 0 && (scope === 'all' || scope === 'skus') });
  const sales = useApi(() => api.sales.list({ q: dq.replace(/^#/, ''), pageSize: 4 }), [dq], { enabled: open && dq.length > 0 && (scope === 'all' || scope === 'sales') });
  const users = useApi(() => api.users.list(), [open], { enabled: open && canUsers && (scope === 'all' || scope === 'users') });

  const items = useMemo(() => {
    const out: { key: string; group: string; href: string; node: React.ReactNode }[] = [];
    if (scope === 'all' || scope === 'products') for (const p of products.data?.data ?? []) out.push({ key: `p${p.id}`, group: 'Products', href: `/products/${p.id}`, node: <><Thumb tint={p.tint} src={p.coverImage} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{hl(p.name, dq)}</span><span className="block text-xs text-ink-2">{p.brand.name} · {p.variantCount} variants · {p.totalQty} in stock</span></span>{p.status === 'ARCHIVED' ? <Badge>Archived</Badge> : <span className="tabular text-sm">{formatMoney(p.defaultPrice)}</span>}</> });
    if (scope === 'all' || scope === 'skus') for (const v of skus.data ?? []) out.push({ key: `v${v.id}`, group: 'SKUs & barcodes', href: `/products/${v.productId}`, node: <><ScanLine className="size-4 text-ink-3" aria-hidden /><span className="min-w-0 flex-1 text-sm"><span className="tabular font-semibold">{hl(v.sku, dq)}</span> · {v.product.name} · {v.size} · {v.color.name}</span><StockBadge status={stockStatus(v.quantity, v.lowStockThreshold)} qty={v.quantity} /></> });
    if (scope === 'all' || scope === 'sales') for (const s of sales.data?.data ?? []) out.push({ key: `s${s.id}`, group: 'Sales', href: `/sales?open=${s.id}`, node: <><Receipt className="size-4 text-ink-3" aria-hidden /><span className="min-w-0 flex-1 text-sm"><span className="tabular font-semibold">{hl(s.number, dq)}</span> · {s.items.length} item(s) · {s.sellerName} · {formatTime(s.createdAt)}</span><span className="tabular text-sm">{formatMoney(s.total)}</span></> });
    if (canUsers && (scope === 'all' || scope === 'users')) for (const u of (users.data ?? []).filter((u) => dq && (u.name.toLowerCase().includes(dq.toLowerCase()) || u.email.includes(dq.toLowerCase()) || dq.startsWith('@')))) out.push({ key: `u${u.id}`, group: 'Users', href: '/users', node: <><UserRound className="size-4 text-ink-3" aria-hidden /><span className="min-w-0 flex-1 text-sm">{hl(u.name, dq.replace(/^@/, ''))} <span className="text-ink-2">· {u.email}</span></span><Badge>{u.role}</Badge></> });
    return out;
  }, [products.data, skus.data, sales.data, users.data, dq, scope, canUsers]);

  useEffect(() => { setCursor(0); }, [dq, scope]);
  useEffect(() => { if (!open) { setQ(''); setScope('all'); } }, [open]);

  if (!open || typeof document === 'undefined') return null;
  const go = (href: string) => { onClose(); router.push(href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(items.length - 1, c + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    if (e.key === 'Enter' && items[cursor]) go(items[cursor]!.href);
  };
  const loading = products.loading || skus.loading || sales.loading;
  let lastGroup = '';

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/35 p-3 pt-[12vh]" onClick={onClose}>
      <div role="dialog" aria-label="Global search" className="flex w-full max-w-[680px] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-float" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <label className="flex min-h-14 items-center gap-3 border-b border-line px-4"><Search className="size-5 text-ink-2" aria-hidden /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, SKUs, sale numbers…" aria-label="Search everything" className="flex-1 bg-transparent text-base outline-none placeholder:text-ink-3" /><Kbd>esc</Kbd></label>
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-2">
          {(['all', 'products', 'skus', 'sales', ...(canUsers ? (['users'] as Scope[]) : [])] as Scope[]).map((s) => <Chip key={s} size="sm" selected={scope === s} onClick={() => setScope(s)}>{s === 'all' ? 'All' : s === 'skus' ? 'SKUs' : s[0]!.toUpperCase() + s.slice(1)}</Chip>)}
          <span className="ml-auto text-xs text-ink-2">{dq ? `${items.length} results · ${Math.round(performance.now() - started)} ms` : ''}</span>
        </div>
        <div className="max-h-[56vh] overflow-y-auto py-1" role="listbox">
          {!dq && <p className="px-4 py-8 text-center text-sm text-ink-2">Type a product name, SKU, barcode or <Kbd>#</Kbd> sale number.</p>}
          {dq && !loading && items.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-2">No results for “{dq}”.</p>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup; lastGroup = it.group;
            return (
              <div key={it.key}>
                {header && <p className="eyebrow px-4 pb-1 pt-3 text-ink-3">{it.group}</p>}
                <button type="button" role="option" aria-selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => go(it.href)} className={cn('flex min-h-11 w-full items-center gap-3 px-4 py-1.5 text-left', i === cursor && 'bg-accent-soft')}>{it.node}{i === cursor && <Kbd>↵</Kbd>}</button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-ink-2"><span><Kbd>↑↓</Kbd> navigate</span><span><Kbd>↵</Kbd> open</span><span className="ml-auto">Type <Kbd>#</Kbd> for a sale number{canUsers && <>, <Kbd>@</Kbd> for a user</>}</span></div>
      </div>
    </div>,
    document.body,
  );
}

function hl(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark className="rounded-sm bg-warn-soft text-inherit">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}
