'use client';
/** Bulk tab of /stock/adjust: editable table, CSV paste (sku,qty), review dialog → POST /stock/adjustments. */
import { useState } from 'react';
import { ClipboardPaste, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useBreakpoint, useMutation } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { formatMoney, REASON_LABEL } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog, Dialog } from '@/components/ui/Overlay';
import { EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { VariantRow, VariantSearch } from './VariantSearch';
import { deltaClass, parseSkuQtyCsv, REASONS, signedQty, variantTitle } from './stock-utils';
import type { AdjustmentReason, VariantWithProduct } from '@/types';

interface BulkRow { variant: VariantWithProduct; after: string; reason: AdjustmentReason }
interface Computed extends BulkRow { afterN: number; delta: number; error?: string; value?: number }

const TH = 'whitespace-nowrap border-b border-line px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2';
const TD = 'border-b border-line px-3 py-2 align-middle group-last:border-0';

export function BulkAdjust({ allowNegative }: { allowNegative: boolean }) {
  const auth = useAuth();
  const bp = useBreakpoint();
  const { toast } = useToast();
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [parsing, setParsing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const add = (v: VariantWithProduct, qty?: number) => setRows((rs) => {
    if (rs.some((r) => r.variant.id === v.id)) return rs.map((r) => (r.variant.id === v.id && qty !== undefined ? { ...r, after: String(qty) } : r));
    return [...rs, { variant: v, after: String(qty ?? v.quantity), reason: 'CORRECTION' }];
  });
  const patch = (id: string, p: Partial<Pick<BulkRow, 'after' | 'reason'>>) => setRows((rs) => rs.map((r) => (r.variant.id === id ? { ...r, ...p } : r)));
  const remove = (id: string) => setRows((rs) => rs.filter((r) => r.variant.id !== id));

  const computed: Computed[] = rows.map((r) => {
    const afterN = parseInt(r.after, 10);
    const valid = Number.isFinite(afterN);
    const delta = valid ? afterN - r.variant.quantity : 0;
    const error = !valid ? 'Enter a quantity' : afterN < 0 && !allowNegative ? 'Negative stock is off in Settings' : undefined;
    return { ...r, afterN, delta, error, value: r.variant.costPrice !== undefined ? delta * r.variant.costPrice : undefined };
  });
  const changed = computed.filter((c) => !c.error && c.delta !== 0);
  const errors = computed.filter((c) => c.error).length;
  const netDelta = changed.reduce((a, c) => a + c.delta, 0);
  const valueDelta = changed.reduce((a, c) => a + (c.value ?? 0), 0);

  const pasteCsv = async () => {
    const parsed = parseSkuQtyCsv(csv);
    if (parsed.length === 0) { toast({ kind: 'error', title: 'Nothing to import', body: 'Use one line per variant: sku,qty' }); return; }
    setParsing(true);
    const results = await Promise.all(parsed.map(async (p) => { try { return { v: await api.variants.lookup({ sku: p.sku }), qty: p.qty }; } catch { return { sku: p.sku }; } }));
    const missing = results.filter((r): r is { sku: string } => 'sku' in r).map((r) => r.sku);
    results.forEach((r) => { if ('v' in r && r.v) add(r.v, r.qty); });
    setParsing(false);
    setCsvOpen(false);
    setCsv('');
    toast({ kind: missing.length ? 'info' : 'success', title: `${results.length - missing.length} row${results.length - missing.length === 1 ? '' : 's'} added`, body: missing.length ? `Unknown SKU: ${missing.join(', ')}` : undefined });
  };

  const apply = useMutation(() => api.stock.adjust(changed.map((c) => ({ variantId: c.variant.id, newQty: c.afterN, reason: c.reason }))));
  const onApply = async () => {
    try {
      const n = changed.length;
      await apply.mutate();
      setConfirm(false);
      setRows([]);
      toast({ kind: 'success', title: `${n} adjustment${n === 1 ? '' : 's'} applied`, body: `Net ${signedQty(netDelta)} units` });
    } catch (e) { toast({ kind: 'error', title: "Couldn't apply adjustments", body: (e as Error).message }); }
  };

  const reasonSelect = (c: Computed) => c.error ? <span className="text-xs text-danger-ink">{c.error}</span> : c.delta === 0 ? <span className="text-xs text-ink-2">—</span> : (
    <Select size="sm" aria-label={`Reason for ${c.variant.sku}`} value={c.reason} onChange={(e) => patch(c.variant.id, { reason: e.target.value as AdjustmentReason })}>{REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}</Select>
  );
  const afterInput = (c: Computed) => <Input size="sm" type="number" inputMode="numeric" align="center" value={c.after} invalid={!!c.error} onChange={(e) => patch(c.variant.id, { after: e.target.value })} wrapperClassName="w-[76px]" aria-label={`New quantity for ${c.variant.sku}`} />;
  const deltaCell = (c: Computed) => c.error ? <span className="text-danger-ink">invalid</span> : <span className={cn('tabular font-semibold', deltaClass(c.delta))}>{signedQty(c.delta)}</span>;

  return (
    <>
      <Card as="section" padded={false} aria-labelledby="adj-bulk" className="flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-5">
          <h2 id="adj-bulk" className="flex-1 text-[15px] font-semibold">Bulk adjustment · table edit</h2>
          <Button size="sm" leading={<ClipboardPaste />} onClick={() => setCsvOpen(true)}>Paste from CSV</Button>
        </div>
        <div className="px-4 py-3 md:px-5"><VariantSearch onPick={(v) => add(v)} placeholder="Add a row: search variant, SKU or scan" /></div>

        {computed.length === 0 ? <EmptyState compact title="No rows yet" body="Search above to add variants one by one, or paste a sku,qty list." /> : bp === 'mobile' ? (
          <ul className="flex flex-col divide-y divide-line border-t border-line">
            {computed.map((c) => (
              <li key={c.variant.id} className="flex flex-col gap-2.5 px-4 py-3">
                <VariantRow v={{ name: c.variant.product.name, size: c.variant.size, color: c.variant.color, sku: c.variant.sku, hint: `${c.variant.quantity} before` }} trailing={<Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${c.variant.sku}`} onClick={() => remove(c.variant.id)}><X /></Button>} />
                <div className="flex items-center gap-3"><span className="text-xs text-ink-2">After</span>{afterInput(c)}<span className="text-xs text-ink-2">Δ</span>{deltaCell(c)}<div className="ml-auto min-w-0 flex-1">{reasonSelect(c)}</div></div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full border-separate border-spacing-0 text-sm" aria-label="Bulk adjustment rows">
              <thead><tr><th scope="col" className={TH}>Variant</th><th scope="col" className={`${TH} text-right`}>Before</th><th scope="col" className={`${TH} text-right`}>After</th><th scope="col" className={`${TH} text-right`}>Δ</th>{auth.isManager && <th scope="col" className={`${TH} text-right`}>Value Δ</th>}<th scope="col" className={`${TH} w-[200px]`}>Reason</th><th scope="col" className={`${TH} w-10`}><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {computed.map((c) => (
                  <tr key={c.variant.id} className="group">
                    <td className={TD}><p className="text-sm font-medium">{variantTitle(c.variant.product.name, c.variant.size, c.variant.color.name)}</p><p className="tabular text-xs text-ink-2">{c.variant.sku}</p></td>
                    <td className={`${TD} tabular text-right text-ink-2`}>{c.variant.quantity}</td>
                    <td className={`${TD} text-right`}><div className="flex justify-end">{afterInput(c)}</div></td>
                    <td className={`${TD} text-right`}>{deltaCell(c)}</td>
                    {auth.isManager && <td className={`${TD} tabular text-right ${c.value !== undefined && !c.error ? deltaClass(c.delta) : 'text-ink-2'}`}>{c.error || c.value === undefined ? '—' : formatMoney(c.value, 'EGP', { signed: true })}</td>}
                    <td className={TD}>{reasonSelect(c)}</td>
                    <td className={`${TD} px-1 text-right`}><Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${c.variant.sku}`} onClick={() => remove(c.variant.id)}><X /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-col gap-2.5 border-t border-line px-4 py-3 md:px-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-input bg-surface-2 px-3 py-2.5 text-[13px]">
            <span><span className="text-ink-2">Rows</span> <span className="tabular font-semibold">{computed.length}</span></span>
            <span><span className="text-ink-2">Changed</span> <span className="tabular font-semibold">{changed.length}</span></span>
            <span><span className="text-ink-2">Net Δ</span> <span className={cn('tabular font-semibold', deltaClass(netDelta))}>{signedQty(netDelta)}</span></span>
            {auth.isManager && <span><span className="text-ink-2">Value Δ</span> <span className={cn('tabular font-semibold', deltaClass(valueDelta))}>{formatMoney(valueDelta, 'EGP', { signed: true })}</span></span>}
            {errors > 0 && <span className="ml-auto text-danger-ink" role="alert">{errors} error{errors === 1 ? '' : 's'}</span>}
          </div>
          <div className="flex justify-end gap-2">
            <Button disabled={rows.length === 0} onClick={() => setRows([])}>Discard</Button>
            <Button variant="primary" disabled={changed.length === 0 || errors > 0} onClick={() => setConfirm(true)}>Review &amp; apply {changed.length || ''}</Button>
          </div>
        </div>
      </Card>

      <Dialog open={csvOpen} onClose={() => setCsvOpen(false)} title="Paste from CSV" description="One line per variant: sku,qty — qty is the new counted quantity (the “After” value)."
        footer={<><Button onClick={() => setCsvOpen(false)}>Cancel</Button><Button variant="primary" loading={parsing} onClick={() => void pasteCsv()}>Add rows</Button></>}>
        <Field label="Rows" htmlFor="csv-rows"><Textarea id="csv-rows" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'NL-LSR-M-BLK,4\nNL-CHS-32-SAN,2'} className="tabular min-h-[140px] font-mono text-sm" data-autofocus /></Field>
      </Dialog>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void onApply()} pending={apply.pending} title={`Apply ${changed.length} adjustment${changed.length === 1 ? '' : 's'}?`} confirmLabel="Apply"
        description="Each row becomes an ADJUSTMENT movement under your name. This cannot be undone, but a later adjustment can correct it.">
        <ul className="flex max-h-[40vh] flex-col divide-y divide-line overflow-y-auto text-sm">
          {changed.map((c) => <li key={c.variant.id} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1 truncate">{variantTitle(c.variant.product.name, c.variant.size, c.variant.color.name)}</span><span className="tabular text-ink-2">{c.variant.quantity} → {c.afterN}</span><span className={cn('tabular w-12 text-right font-semibold', deltaClass(c.delta))}>{signedQty(c.delta)}</span></li>)}
        </ul>
      </ConfirmDialog>
    </>
  );
}
