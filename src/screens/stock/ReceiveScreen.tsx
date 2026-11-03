'use client';
/**
 * Screen: /stock/receive · Roles: ADMIN, MANAGER (stock.receive)
 * Calls: GET /suppliers · POST /suppliers (inline create) · GET /variants/search · GET /variants/lookup (scan)
 *        GET /labels?variantIds (pre-add from ?variantId / ?variantIds) · GET /products/:id (pre-add from ?productId)
 *        POST /stock/purchases · GET /stock/purchases (Purchases tab)
 * Posting is final: it adds PURCHASE movements and recomputes each variant's weighted average cost.
 * Layout: lines + recent purchases on the left, sticky summary aside on xl; mobile uses line cards and a sticky footer.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useApi, useBreakpoint, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { formatMoney } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, Divider } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Combobox, Tabs } from '@/components/ui/Controls';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { VariantSearch } from './VariantSearch';
import { PurchasesTab } from './PurchasesTab';
import { newAvgCost, ReceiveLineCards, ReceiveLinesTable, type ReceiveLine } from './ReceiveLines';
import { localDateIso, variantTitle, withProductDetail } from './stock-utils';
import type { VariantWithProduct } from '@/types';

interface Draft { supplierId?: string; invoiceRef: string; receivedAt: string; lines: ReceiveLine[] }
const DRAFT_KEY = 'avenue.receive.draft';
type Tab = 'new' | 'purchases';

export function ReceiveScreen() {
  const params = useSearchParams();
  const bp = useBreakpoint();
  const auth = useAuth();
  const { toast } = useToast();
  const showCost = auth.isManager;

  const [tab, setTab] = useState<Tab>(params.get('tab') === 'purchases' ? 'purchases' : 'new');
  const [supplierId, setSupplierId] = useState<string>();
  const [invoiceRef, setInvoiceRef] = useState('');
  const [receivedAt, setReceivedAt] = useState(localDateIso);
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  const suppliers = useApi(() => api.catalog.suppliers(), []);
  const purchaseCount = useApi(() => api.stock.purchases(1, 1), []);

  const addVariant = useCallback((v: VariantWithProduct, qty = 1) => setLines((ls) => {
    const i = ls.findIndex((l) => l.variant.id === v.id);
    if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l));
    return [...ls, { variant: v, qty, unitCost: v.costPrice ?? 0 }];
  }), []);

  // Pre-add lines from the URL; otherwise offer the saved draft.
  const preIds = params.get('variantIds') ?? params.get('variantId');
  const preProduct = params.get('productId');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (preIds) { const vs = await api.labels(preIds.split(',').filter(Boolean)); if (!cancelled) vs.forEach((v) => addVariant(v)); return; }
      if (preProduct) { const p = await api.products.get(preProduct); if (!cancelled) p.variants.filter((v) => v.isActive).forEach((v) => addVariant(withProductDetail(p, v))); return; }
      try { if (localStorage.getItem(DRAFT_KEY)) setHasDraft(true); } catch { /* private mode */ }
    })().catch((e: Error) => toast({ kind: 'error', title: "Couldn't pre-fill lines", body: e.message }));
    return () => { cancelled = true; };
  }, [preIds, preProduct, addVariant, toast]);

  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Draft;
      setSupplierId(d.supplierId); setInvoiceRef(d.invoiceRef); setReceivedAt(d.receivedAt); setLines(d.lines);
    } catch { /* ignore */ }
    setHasDraft(false);
  };
  const saveDraft = () => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ supplierId, invoiceRef, receivedAt, lines } satisfies Draft)); toast({ kind: 'success', title: 'Draft saved on this device' }); } catch { toast({ kind: 'error', title: "Couldn't save the draft" }); }
  };
  const reset = () => { setLines([]); setInvoiceRef(''); setReceivedAt(localDateIso()); setConfirm(false); try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

  const lineCount = lines.length;
  const unitCount = lines.reduce((a, l) => a + l.qty, 0);
  const total = lines.reduce((a, l) => a + l.qty * l.unitCost, 0);
  const example = lines.find((l) => l.variant.costPrice !== undefined && newAvgCost(l) !== l.variant.costPrice);

  const createSupplier = async (name: string) => {
    try { const s = await api.catalog.saveSupplier({ name }); await suppliers.refetch(); setSupplierId(s.id); toast({ kind: 'success', title: `Supplier “${s.name}” added` }); }
    catch (e) { toast({ kind: 'error', title: "Couldn't add supplier", body: (e as Error).message }); }
  };

  const post = useMutation(() => api.stock.receive({
    supplierId, invoiceRef: invoiceRef.trim() || undefined,
    receivedAt: receivedAt === localDateIso() ? undefined : `${receivedAt}T12:00:00.000Z`,
    items: lines.map((l) => ({ variantId: l.variant.id, qty: l.qty, unitCost: l.unitCost })),
  }));
  const onPost = async () => {
    try {
      const po = await post.mutate();
      toast({ kind: 'success', title: `${po?.number ?? 'Purchase'} posted`, body: `${unitCount} units received${showCost ? ` · ${formatMoney(total, 'EGP', { withCurrency: true })}` : ''}` });
      reset();
      void purchaseCount.refetch();
    } catch (e) { toast({ kind: 'error', title: "Couldn't post the purchase", body: (e as Error).message }); }
  };

  const summary = (
    <>
      <div className="flex justify-between text-sm"><span className="text-ink-2">Lines</span><span className="tabular">{lineCount}</span></div>
      <div className="flex justify-between text-sm"><span className="text-ink-2">Units</span><span className="tabular">{unitCount}</span></div>
      {showCost && <div className="flex justify-between text-sm"><span className="text-ink-2">Total cost</span><span className="tabular font-semibold">{formatMoney(total, 'EGP', { withCurrency: true })}</span></div>}
    </>
  );

  return (
    <>
      <PageHeader title="Receive stock" crumbs={[{ label: 'Stock', href: '/stock/movements' }, { label: 'Receive' }]} compactTitle="Receive">
        <Tabs className="mt-2 px-4 md:px-6" value={tab} onChange={setTab} items={[{ value: 'new', label: 'New purchase' }, { value: 'purchases', label: 'Purchases', count: purchaseCount.data?.total }]} />
      </PageHeader>
      <Page>
        {tab === 'purchases' ? <PurchasesTab /> : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-4">
              {hasDraft && lines.length === 0 && (
                <div role="status" className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-accent-soft px-4 py-3 text-sm text-accent">
                  <span className="flex-1">You have an unposted draft on this device.</span>
                  <Button size="sm" variant="primary" onClick={restoreDraft}>Restore draft</Button>
                  <Button size="sm" variant="ghost" onClick={() => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } setHasDraft(false); }}>Discard</Button>
                </div>
              )}
              <Card as="section" aria-label="Purchase details" className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
                <Field label="Supplier" htmlFor="r-sup">
                  <Combobox aria-label="Supplier" value={supplierId} onChange={setSupplierId} onCreate={(name) => void createSupplier(name)} createLabel="Add supplier"
                    placeholder={suppliers.loading && !suppliers.data ? 'Loading suppliers…' : 'Choose or add a supplier'}
                    options={(suppliers.data ?? []).filter((s) => s.isActive || s.id === supplierId).map((s) => ({ value: s.id, label: s.name, hint: s.purchaseCount ? `${s.purchaseCount} purchases` : undefined }))} />
                </Field>
                <Field label="Invoice ref" htmlFor="r-inv"><Input id="r-inv" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="INV-0000" /></Field>
                <Field label="Received on" htmlFor="r-date"><Input id="r-date" type="date" value={receivedAt} max={localDateIso()} onChange={(e) => setReceivedAt(e.target.value || localDateIso())} /></Field>
              </Card>

              <Card as="section" padded={false} aria-label="Lines" className="flex flex-col overflow-hidden">
                <div className="border-b border-line px-4 py-3"><VariantSearch onPick={(v) => addVariant(v)} size="lg" placeholder="Search product or scan barcode to add a line" /></div>
                {lines.length === 0 ? <EmptyState compact title="No lines yet" body="Search a product above or scan a barcode to add the first line." />
                  : bp === 'mobile' ? <ReceiveLineCards lines={lines} showCost={showCost} onChange={(i, p) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)))} onRemove={(i) => setLines((ls) => ls.filter((_, j) => j !== i))} />
                  : <ReceiveLinesTable lines={lines} showCost={showCost} onChange={(i, p) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)))} onRemove={(i) => setLines((ls) => ls.filter((_, j) => j !== i))} />}
                <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
                  <span className="text-ink-2">{lineCount} line{lineCount === 1 ? '' : 's'} · {unitCount} unit{unitCount === 1 ? '' : 's'}</span>
                  {showCost && <span className="tabular text-base font-semibold">Total {formatMoney(total, 'EGP', { withCurrency: true })}</span>}
                </div>
              </Card>
            </div>

            <Card as="aside" aria-label="Summary" className="hidden flex-col gap-3 self-start md:flex xl:sticky xl:top-20">
              <h2 className="text-[15px] font-semibold">Summary</h2>
              {summary}
              <Divider />
              <Button size="lg" variant="primary" block disabled={lineCount === 0} onClick={() => setConfirm(true)}>Post purchase</Button>
              <Button block disabled={lineCount === 0} onClick={saveDraft}>Save as draft</Button>
              <p className="text-xs text-ink-2">Posting is final. It adds PURCHASE movements and updates each variant&apos;s weighted average cost.</p>
            </Card>

            {/* Mobile: sticky footer */}
            <div className="sticky bottom-0 z-20 -mx-4 flex flex-col gap-2 border-t border-line bg-surface px-4 pb-3 pt-3 md:hidden">
              <div className="flex items-center justify-between text-sm"><span className="text-ink-2">{lineCount} lines · {unitCount} units</span>{showCost && <span className="tabular font-semibold">{formatMoney(total, 'EGP', { withCurrency: true })}</span>}</div>
              <div className="flex gap-2"><Button block disabled={lineCount === 0} onClick={saveDraft}>Save draft</Button><Button variant="primary" block disabled={lineCount === 0} onClick={() => setConfirm(true)}>Post purchase</Button></div>
            </div>
          </div>
        )}
      </Page>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void onPost()} pending={post.pending}
        title={`Post purchase${invoiceRef.trim() ? ` ${invoiceRef.trim()}` : ''}?`} confirmLabel={showCost ? `Post · ${formatMoney(total, 'EGP', { withCurrency: true })}` : 'Post purchase'}>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
          <li>Stock increases by <strong className="tabular font-semibold text-ink">{unitCount} unit{unitCount === 1 ? '' : 's'}</strong> across {lineCount} variant{lineCount === 1 ? '' : 's'}.</li>
          {showCost && <li>Average cost updates per variant{example ? <> (e.g. {variantTitle(example.variant.product.name, example.variant.size, example.variant.color.name)} {formatMoney(example.variant.costPrice ?? 0)} → {formatMoney(newAvgCost(example))})</> : ''}.</li>}
          <li>Recorded under your name in Movements and the Audit log.</li>
        </ul>
      </ConfirmDialog>
    </>
  );
}
