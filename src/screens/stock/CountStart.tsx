'use client';
/** Start form + recent counts for /stock/count when no count is OPEN. */
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { listAllPages } from '@/lib/paging';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { localDateIso } from './stock-utils';
import type { StockCount, StockCountStatus } from '@/types';

const STATUS_TONE: Record<StockCountStatus, 'info' | 'ok' | 'neutral'> = { OPEN: 'info', APPLIED: 'ok', CANCELLED: 'neutral' };
const STATUS_LABEL: Record<StockCountStatus, string> = { OPEN: 'In progress', APPLIED: 'Applied', CANCELLED: 'Cancelled' };

export function CountStart({ recent, canManage, onStarted }: { recent: StockCount[]; canManage: boolean; onStarted: () => void }) {
  const { toast } = useToast();
  const [scope, setScope] = useState(`Full store · ${localDateIso()}`);
  const [brandId, setBrandId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const brands = useApi(() => api.catalog.brands(), []);
  const categories = useApi(() => api.catalog.categories(), []);
  const scoped = !!(brandId || categoryId);
  const products = useApi(() => listAllPages((page, pageSize) => api.products.list({ brandId: brandId || undefined, categoryId: categoryId || undefined, page, pageSize })), [brandId, categoryId], { enabled: scoped });
  const productIds = scoped ? products.data?.data.map((p) => p.id) : undefined;
  const variantCount = products.data?.data.reduce((a, p) => a + p.variantCount, 0);

  const start = useMutation(() => api.stock.startCount(scope.trim(), productIds));
  const onStart = async () => {
    try { const c = await start.mutate(); toast({ kind: 'success', title: `${c?.number ?? 'Count'} started`, body: `${c?.items.length ?? 0} variants to count` }); onStarted(); }
    catch (e) { toast({ kind: 'error', title: "Couldn't start the count", body: (e as Error).message }); }
  };

  const brandName = brands.data?.find((b) => b.id === brandId)?.name;
  const catName = categories.data?.find((c) => c.id === categoryId)?.name;
  const suggested = [brandName, catName].filter(Boolean).join(' · ');

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <Card as="section" aria-labelledby="sc-start" className="flex flex-col gap-4 self-start">
        <div><p className="eyebrow">1 · Session</p><h2 id="sc-start" className="mt-1 text-[15px] font-semibold">Start a stock count</h2><p className="mt-0.5 text-xs text-ink-2">Counting freezes nothing: sales continue and the variance is computed against live quantities when you apply.</p></div>
        {canManage ? (
          <>
            <Field label="Scope label" htmlFor="sc-scope" help={suggested && scope !== suggested ? <button type="button" className="text-accent hover:underline" onClick={() => setScope(suggested)}>Use “{suggested}”</button> : 'Shown in Movements and the Audit log.'}>
              <Input id="sc-scope" value={scope} onChange={(e) => setScope(e.target.value)} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Brand" htmlFor="sc-brand"><Select id="sc-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">All brands</option>{(brands.data ?? []).filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
              <Field label="Category" htmlFor="sc-cat"><Select id="sc-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">All categories</option>{(categories.data ?? []).filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            </div>
            <p className="text-sm text-ink-2" aria-live="polite">
              {scoped ? (products.loading && !products.data ? 'Counting products…' : products.error ? products.error.message : `${products.data?.total ?? 0} product${products.data?.total === 1 ? '' : 's'} · ${variantCount ?? 0} active variants in scope`) : 'Every active variant in the store will be included.'}
            </p>
            <Button size="lg" variant="primary" loading={start.pending} disabled={!scope.trim() || (scoped && (products.loading || (products.data?.total ?? 0) === 0))} onClick={() => void onStart()}>Start count</Button>
          </>
        ) : <p className="text-sm text-ink-2">Only managers can start a count. Ask a manager to open one, then you can scan and count here.</p>}
      </Card>

      <Card as="section" padded={false} aria-label="Recent counts" className="overflow-hidden self-start">
        <CardHeader className="px-4 pt-4 md:px-5 md:pt-5" title="Recent counts" description="Applied counts create ADJUSTMENT movements referenced by their number." />
        {recent.length === 0 ? <EmptyState compact title="No counts yet" body="Start the first count on the left." /> : (
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {recent.map((c) => {
              const counted = c.items.filter((i) => i.countedQty !== null).length;
              const diffs = c.items.filter((i) => i.countedQty !== null && i.countedQty !== i.systemQty).length;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm md:px-5">
                  <div className="min-w-0 flex-1"><p className="font-medium"><span className="tabular">{c.number}</span> · {c.scope}</p><p className="text-xs text-ink-2">Started {formatDateTime(c.startedAt)} by {c.startedByName.split(' ')[0]}{c.appliedAt ? ` · applied ${formatDateTime(c.appliedAt)}` : ''} · {counted}/{c.items.length} counted · {diffs} difference{diffs === 1 ? '' : 's'}</p></div>
                  <Badge tone={STATUS_TONE[c.status]} dot>{STATUS_LABEL[c.status]}</Badge>
                  {c.status === 'APPLIED' && <Link href="/stock/movements" className="text-xs text-accent hover:underline">Movements</Link>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
