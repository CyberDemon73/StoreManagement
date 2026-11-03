'use client';
/**
 * States section of the component gallery: Loading · Empty · Error · Offline · Ready on a demo
 * products list, driven through `mockControls` so the real api → hook → state path is exercised.
 */
import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { api, mockControls } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatMoney } from '@/lib/format';
import { Badge, StockBadge, Thumb } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, Divider } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Field';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { stockStatus } from '@/lib/format';

type Demo = 'loading' | 'empty' | 'error' | 'offline' | 'ready';
const OPTIONS: { value: Demo; label: string }[] = [{ value: 'loading', label: 'Loading' }, { value: 'empty', label: 'Empty' }, { value: 'error', label: 'Error' }, { value: 'offline', label: 'Offline' }, { value: 'ready', label: 'Ready' }];

const RULES: { tone: 'neutral' | 'danger' | 'warn' | 'ok'; label: string; text: string }[] = [
  { tone: 'neutral', label: 'Loading', text: 'Skeletons mirror the final layout (same heights, same columns) so nothing jumps. KPI values are skeletons, not “—”. aria-busy on the region.' },
  { tone: 'neutral', label: 'Empty', text: 'Icon + one-line title + one sentence that names the active filters + the single best action. Different copy for “no data yet” vs “no results for these filters”.' },
  { tone: 'danger', label: 'Error', text: 'Says what failed and that nothing changed. Status code and request id in small text for support. Retry is primary. Inline field errors for 422 instead of a page error.' },
  { tone: 'warn', label: 'Offline', text: 'Persistent top banner with the cache time. Reads keep working from cache; writes are disabled with an inline reason.' },
  { tone: 'ok', label: 'Ready', text: 'Mutations give a toast with Undo where safe (archive, threshold) and a confirm dialog where not (void, post purchase, apply count).' },
];

export function StatesDemo() {
  const [demo, setDemo] = useState<Demo>('loading');
  const [tick, setTick] = useState(0);
  const { toast } = useToast();

  // Arm the mock before the hook re-runs, and always restore the controls when leaving.
  useEffect(() => {
    mockControls.offline = demo === 'offline';
    mockControls.failNext = demo === 'error' ? 1 : 0;
    mockControls.latency = demo === 'loading' ? [60_000, 60_000] : [120, 420];
    setTick((t) => t + 1);
    return () => { mockControls.offline = false; mockControls.failNext = 0; mockControls.latency = [120, 420]; };
  }, [demo]);

  const list = useApi(() => api.products.list({ pageSize: 4, q: demo === 'empty' ? 'zzz-no-such-product' : undefined }), [tick], { enabled: tick > 0 });
  const rows = list.data?.data;
  const countLabel = list.loading && !rows ? '…' : list.error ? (list.error.code === 'OFFLINE' ? `${rows?.length ?? 0} · cached` : 'unavailable') : `${list.data?.total ?? 0}`;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="states-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="eyebrow">Products list · five states</p><h2 id="states-h" className="text-xl font-semibold">Loading · Empty · Error · Offline · Ready</h2></div>
        <Segmented value={demo} onChange={setDemo} options={OPTIONS} aria-label="Preview state" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card padded={false} className="flex min-h-[420px] flex-col overflow-hidden" aria-live="polite">
          {demo === 'offline' && <div role="status" className="flex items-center gap-2.5 bg-warn-soft px-4 py-2.5 text-sm font-medium text-warn-ink"><WifiOff className="size-4" aria-hidden />You&apos;re offline — showing products cached at {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.<Button size="sm" variant="ghost" className="ml-auto text-inherit" onClick={() => setDemo('ready')}>Retry</Button></div>}
          <CardHeader className="border-b border-line px-4 py-3" title="Products" action={<Badge>{countLabel}</Badge>} />
          <div className="grid grid-cols-4 gap-2.5 border-b border-line px-4 py-3">
            {list.loading && !rows ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-[10px]" />) : (['Products', 'Variants', 'Low', 'Out'] as const).map((k) => <div key={k} className="rounded-card border border-line px-3 py-2.5"><p className="eyebrow text-[10px]">{k}</p><p className="tabular font-semibold">{list.error && !rows ? '—' : k === 'Products' ? list.data?.total ?? 0 : k === 'Variants' ? rows?.reduce((a, p) => a + p.variantCount, 0) ?? 0 : k === 'Low' ? rows?.reduce((a, p) => a + p.lowCount, 0) ?? 0 : rows?.reduce((a, p) => a + p.outCount, 0) ?? 0}</p></div>)}
          </div>
          <div className="flex flex-1 flex-col px-4 py-2">
            {list.loading && !rows ? <SkeletonRows rows={5} /> : list.error && !rows ? (
              list.error.code === 'OFFLINE' ? <ErrorState error={list.error} compact onRetry={() => setDemo('ready')} /> : <ErrorState error={list.error} title="Couldn't load products" compact onRetry={() => setDemo('ready')} />
            ) : rows && rows.length === 0 ? (
              <EmptyState compact title="No products match" body="Try clearing “Brand: Dune Kids” and “Stock: Out”, or add a product." action={<><Button onClick={() => setDemo('ready')}>Clear filters</Button><Button variant="primary">Add product</Button></>} />
            ) : rows ? (
              <ul>
                {rows.map((p) => <li key={p.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0"><Thumb tint={p.tint} src={p.coverImage} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block text-xs text-ink-2">{p.brand.name} · {p.variantCount} variants</span></span><span className="tabular text-sm">{formatMoney(p.defaultPrice)}</span><StockBadge status={stockStatus(p.totalQty, p.lowCount ? p.totalQty : 0)} qty={p.totalQty} /></li>)}
                {demo === 'offline' && <li className="py-2.5 text-xs text-ink-2">Quantities may be stale. Adding to cart still works; charging waits for a connection.</li>}
              </ul>
            ) : null}
          </div>
        </Card>
        <Card className="flex flex-col gap-3.5">
          <h3 className="text-[15px] font-semibold">Rules every screen follows</h3>
          <ul className="flex flex-col gap-2.5 text-[13px]">{RULES.map((r) => <li key={r.label} className="flex items-start gap-3"><Badge tone={r.tone} className="w-[72px] justify-center">{r.label}</Badge><p className="text-ink-2">{r.text}</p></li>)}</ul>
          <Divider />
          <h3 className="text-sm font-semibold">Toast variants</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => toast({ kind: 'success', title: 'Product archived', action: { label: 'Undo', onClick: () => toast({ kind: 'info', title: 'Restored' }) } })}>Success</Button>
            <Button size="sm" onClick={() => toast({ kind: 'error', title: "Couldn't save threshold · try again" })}>Error</Button>
            <Button size="sm" onClick={() => toast({ kind: 'info', title: 'A new version is available', action: { label: 'Refresh', onClick: () => undefined } })}>Info</Button>
            <Button size="sm" onClick={() => { const id = toast({ kind: 'pending', title: 'Posting purchase…' }); setTimeout(() => { dismissLater(id); toast({ kind: 'success', title: 'Purchase PO-0148 posted' }); }, 1500); }}>Pending</Button>
          </div>
        </Card>
      </div>
    </section>
  );
}

// Pending toasts stay for 60 s by default; the demo swaps them for a success after 1.5 s.
let dismissLater: (id: number) => void = () => undefined;
export function BindDismiss() {
  const { dismiss } = useToast();
  dismissLater = dismiss;
  return null;
}
