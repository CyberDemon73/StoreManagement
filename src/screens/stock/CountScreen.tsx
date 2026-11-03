'use client';
/**
 * Screen: /stock/count · Roles: ADMIN, MANAGER (stock.count.manage to start/apply), SELLER may count (stock.count.read)
 * Calls: GET /stock/counts · POST /stock/counts (start) · PATCH /stock/counts/:id (save counts, debounced)
 *        GET /variants/lookup (scan) · POST /stock/counts/:id/apply (creates ADJUSTMENT movements)
 * Three phases left→right: session + counting on the left, variance review on the right; mobile stacks counting first.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ScanLine } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { formatDateTime, formatMoney, formatTime } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, Progress } from '@/components/ui/Card';
import { Input, Toggle } from '@/components/ui/Field';
import { QuantityInput, Stepper } from '@/components/ui/Controls';
import { Badge, ColorSwatch } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { BarcodeScannerButton } from '@/components/app/BarcodeScanner';
import { CountStart } from './CountStart';
import { CountReview, LARGE_VARIANCE, type ReviewRow } from './CountReview';
import { deltaClass, signedQty, variantTitle } from './stock-utils';
import type { AdjustmentReason, StockCount } from '@/types';

const STEPS = ['Start', 'Count', 'Review', 'Apply'];

export function CountScreen() {
  const auth = useAuth();
  const counts = useApi(() => api.stock.counts(), []);
  const [applied, setApplied] = useState<StockCount>();
  const open = counts.data?.find((c) => c.status === 'OPEN');
  const canManage = auth.can('stock.count.manage');
  const title = applied ? `Stock count ${applied.number}` : open ? `Stock count ${open.number}` : 'Stock count';

  return (
    <>
      <PageHeader title={title} compactTitle="Stock count" crumbs={[{ label: 'Stock' }, { label: title }]}
        actions={<Stepper steps={STEPS} current={applied ? 4 : open ? (open.items.some((i) => i.countedQty !== null) ? 2 : 1) : 0} className="min-w-[260px]" />} />
      <Page>
        {applied ? <AppliedCard count={applied} onNew={() => { setApplied(undefined); void counts.refetch(); }} canManage={canManage} />
          : counts.initial ? <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]"><div className="flex flex-col gap-4"><Skeleton className="h-36 rounded-card" /><Skeleton className="h-56 rounded-card" /></div><Skeleton className="h-[480px] rounded-card" /></div>
          : counts.error && !counts.data ? <ErrorState error={counts.error} onRetry={() => void counts.refetch()} />
          : !open ? <CountStart recent={counts.data ?? []} canManage={canManage} onStarted={() => void counts.refetch()} />
          : <OpenCount key={open.id} initial={open} canManage={canManage} onApplied={setApplied} />}
      </Page>
    </>
  );
}

function OpenCount({ initial, canManage, onApplied }: { initial: StockCount; canManage: boolean; onApplied: (c: StockCount) => void }) {
  const auth = useAuth();
  const { toast } = useToast();
  const [count, setCount] = useState(initial);
  const [filter, setFilter] = useState<'diff' | 'all'>('diff');
  const [uncountedZero, setUncountedZero] = useState(false);
  const [reasons, setReasons] = useState<Record<string, AdjustmentReason>>({});
  const [last, setLast] = useState<string>();
  const [scan, setScan] = useState('');
  const [confirm, setConfirm] = useState(false);
  const pending = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = useCallback(async () => {
    const items = Array.from(pending.current, ([variantId, countedQty]) => ({ variantId, countedQty }));
    pending.current.clear();
    if (items.length === 0) return;
    try {
      const saved = await api.stock.saveCounts(count.id, items);
      setCount((c) => ({ ...c, counters: saved.counters, items: c.items.map((it) => { const s = saved.items.find((x) => x.variantId === it.variantId); return s && items.some((i) => i.variantId === it.variantId) ? { ...it, countedBy: s.countedBy, countedAt: s.countedAt } : it; }) }));
    } catch (e) { toast({ kind: 'error', title: "Couldn't save counts", body: `${(e as Error).message} Your entries are kept on screen; keep counting and they will retry.` }); items.forEach((i) => pending.current.set(i.variantId, i.countedQty)); }
  }, [count.id, toast]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const setCounted = useCallback((variantId: string, qty: number | null) => {
    setCount((c) => ({ ...c, items: c.items.map((it) => (it.variantId === variantId ? { ...it, countedQty: qty, countedBy: qty === null ? undefined : it.countedBy ?? auth.user?.name, countedAt: qty === null ? undefined : new Date().toISOString() } : it)) }));
    if (qty === null) pending.current.delete(variantId);
    else { pending.current.set(variantId, qty); clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), 600); }
  }, [auth.user?.name, flush]);

  const bump = (variantId: string) => { const it = count.items.find((i) => i.variantId === variantId); if (!it) return false; setCounted(variantId, (it.countedQty ?? 0) + 1); setLast(variantId); return true; };
  const onScan = async (code: string) => {
    const c = code.trim(); if (!c) return;
    const local = count.items.find((i) => i.variant.sku.toLowerCase() === c.toLowerCase());
    if (local) { bump(local.variantId); setScan(''); return; }
    try { const v = await api.variants.lookup(/^\d+$/.test(c) ? { barcode: c } : { sku: c }); if (!bump(v.id)) toast({ kind: 'info', title: 'Not in this count', body: `${variantTitle(v.product.name, v.size, v.color.name)} is outside the scope “${count.scope}”.` }); setScan(''); }
    catch (e) { toast({ kind: 'error', title: `No variant with code ${c}`, body: (e as Error).message }); }
  };

  const rows: ReviewRow[] = useMemo(() => count.items.map((it) => {
    const counted = it.countedQty ?? (uncountedZero ? 0 : null);
    const variance = counted === null ? null : counted - it.systemQty;
    const value = variance !== null && it.variant.costPrice !== undefined ? variance * it.variant.costPrice : undefined;
    return { ...it, counted, variance, value, flagged: variance !== null && Math.abs(variance) >= LARGE_VARIANCE };
  }), [count.items, uncountedZero]);
  const countedN = count.items.filter((i) => i.countedQty !== null).length;
  const diffs = rows.filter((r) => r.variance !== null && r.variance !== 0);
  const netUnits = diffs.reduce((a, r) => a + (r.variance ?? 0), 0);
  const netValue = diffs.reduce((a, r) => a + (r.value ?? 0), 0);
  const flagged = rows.filter((r) => r.flagged && r.countedQty !== null);
  const lastItem = last ? count.items.find((i) => i.variantId === last) : undefined;

  const apply = useMutation(async () => { await flush(); return api.stock.applyCount(count.id, uncountedZero); });
  const onApply = async () => {
    try { const c = await apply.mutate(); setConfirm(false); toast({ kind: 'success', title: `${count.number} applied`, body: `${diffs.length} adjustment${diffs.length === 1 ? '' : 's'} · net ${signedQty(netUnits)} units` }); if (c) onApplied(c); }
    catch (e) { toast({ kind: 'error', title: "Couldn't apply the count", body: (e as Error).message }); }
  };

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col-reverse gap-4 xl:flex-col">
          <Card as="section" aria-label="Session" className="flex flex-col gap-2 text-sm">
            <p className="eyebrow">1 · Session</p>
            <p><span className="font-semibold">Scope:</span> {count.scope}</p>
            <p><span className="font-semibold">Started:</span> {formatDateTime(count.startedAt)} by {count.startedByName.split(' ')[0]}</p>
            <p><span className="font-semibold">Counters:</span> {count.counters.join(', ')}</p>
            <Badge tone="info" dot className="self-start">In progress</Badge>
          </Card>
          <Card as="section" aria-label="Counting" className="flex flex-col gap-3">
            <p className="eyebrow">2 · Counting</p>
            <div className="flex items-center justify-between text-sm"><span>Progress</span><span className="tabular font-semibold">{countedN} / {count.items.length} variants</span></div>
            <Progress value={countedN} max={Math.max(1, count.items.length)} className="h-2" />
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void onScan(scan); }}>
              <Input size="lg" value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan or type SKU" aria-label="Scan to count" leading={<ScanLine aria-hidden />} autoFocus />
              <BarcodeScannerButton size="lg" aria-label="Open camera scanner" onScan={(v) => { if (!bump(v.id)) toast({ kind: 'info', title: 'Not in this count', body: `${v.sku} is outside the scope.` }); }} />
            </form>
            {lastItem ? (
              <div className="flex items-center gap-2.5 rounded-input bg-surface-2 px-3 py-2.5">
                <ColorSwatch hex={lastItem.variant.color.hex} name={lastItem.variant.color.name} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{variantTitle(lastItem.variant.productName, lastItem.variant.size, lastItem.variant.color.name)}</p><p className="text-xs text-ink-2">last scanned · {lastItem.countedAt ? formatTime(lastItem.countedAt) : 'now'} · system {lastItem.systemQty}</p></div>
                <QuantityInput size="sm" value={lastItem.countedQty ?? 0} onChange={(q) => setCounted(lastItem.variantId, q)} aria-label="Counted quantity" />
              </div>
            ) : <p className="rounded-input bg-surface-2 px-3 py-2.5 text-xs text-ink-2">Scan a label or type a SKU and press Enter. Each scan adds one unit; adjust with − / +.</p>}
            <p className="text-xs text-ink-2">{count.items.length - countedN} variant{count.items.length - countedN === 1 ? '' : 's'} not yet counted will be treated as “unchanged” unless you turn on “uncounted = 0”.</p>
            <Toggle checked={uncountedZero} onChange={setUncountedZero} label="Uncounted = 0" description="Treat every uncounted variant as zero on hand when applying." />
          </Card>
        </div>

        <Card as="section" padded={false} aria-label="Variance review" className="flex min-w-0 flex-col overflow-hidden self-start">
          <CountReview rows={rows} allCount={count.items.length} filter={filter} onFilter={setFilter} reasons={reasons} onReason={(id, r) => setReasons((m) => ({ ...m, [id]: r }))} onCounted={setCounted} showValue={auth.isManager} />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-3 text-[13px] md:px-5">
            <span><span className="text-ink-2">Net units</span> <span className={cn('tabular font-semibold', deltaClass(netUnits))}>{signedQty(netUnits)}</span></span>
            {auth.isManager && <span><span className="text-ink-2">Net value</span> <span className={cn('tabular font-semibold', deltaClass(netValue))}>{formatMoney(netValue, 'EGP', { signed: true })}</span></span>}
            <span><span className="text-ink-2">Adjustments</span> <span className="tabular font-semibold">{diffs.length}</span></span>
            <div className="ml-auto flex gap-2">
              <Button disabled={flagged.length === 0} onClick={() => { flagged.forEach((r) => setCounted(r.variantId, null)); setLast(undefined); toast({ kind: 'info', title: `${flagged.length} row${flagged.length === 1 ? '' : 's'} cleared for recount` }); }}>Recount flagged{flagged.length ? ` · ${flagged.length}` : ''}</Button>
              {canManage && <Button variant="primary" disabled={diffs.length === 0} onClick={() => setConfirm(true)}>4 · Apply {diffs.length} adjustment{diffs.length === 1 ? '' : 's'}</Button>}
            </div>
          </div>
        </Card>
      </div>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void onApply()} pending={apply.pending} title={`Apply ${diffs.length} adjustment${diffs.length === 1 ? '' : 's'} from ${count.number}?`} confirmLabel="Apply count"
        description={`Net ${signedQty(netUnits)} units${auth.isManager ? ` · ${formatMoney(netValue, 'EGP', { signed: true })} at cost` : ''}. ${uncountedZero ? `${count.items.length - countedN} uncounted variants will be set to 0.` : `${count.items.length - countedN} uncounted variants stay unchanged.`} Each difference becomes an ADJUSTMENT movement referencing ${count.number}; the count then closes.`}>
        {flagged.length > 0 && <p className="rounded-input bg-warn-soft px-3 py-2 text-sm text-warn-ink">{flagged.length} row{flagged.length === 1 ? ' has' : 's have'} a variance of {LARGE_VARIANCE} or more. Consider “Recount flagged” first.</p>}
      </ConfirmDialog>
    </>
  );
}

function AppliedCard({ count, onNew, canManage }: { count: StockCount; onNew: () => void; canManage: boolean }) {
  const n = count.items.filter((i) => i.countedQty !== null && i.countedQty !== i.systemQty).length;
  return (
    <Card className="mx-auto w-full max-w-[560px]">
      <EmptyState title={`${count.number} applied`} body={`${n} adjustment${n === 1 ? '' : 's'} were recorded as ADJUSTMENT movements${count.appliedAt ? ` on ${formatDateTime(count.appliedAt)}` : ''}. Scope: ${count.scope}.`}
        action={<><LinkButton variant="primary" href="/stock/movements">View movements</LinkButton>{canManage && <Button onClick={onNew}>Start another count</Button>}</>} />
      <p className="text-center text-xs text-ink-2"><Link href="/audit" className="hover:text-ink">Audit log</Link> keeps who applied it and when.</p>
    </Card>
  );
}
