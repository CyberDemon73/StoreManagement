'use client';
/**
 * Screen: /stock/adjust · Roles: ADMIN, MANAGER (stock.adjust)
 * Calls: GET /settings (allowNegativeStock) · GET /variants/search · GET /variants/lookup (scan, CSV paste)
 *        POST /stock/adjustments (single item or array, each with newQty + reason)
 * Reasons: Damaged / Lost / Found / Correction / Other.
 */
import { useState } from 'react';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { formatMoney, formatNumber, REASON_LABEL } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, KpiCard } from '@/components/ui/Card';
import { Field, Input, Segmented, Select } from '@/components/ui/Field';
import { QuantityInput } from '@/components/ui/Controls';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { VariantRow, VariantSearch } from './VariantSearch';
import { BulkAdjust } from './AdjustBulk';
import { REASONS, signedQty, variantTitle } from './stock-utils';
import type { AdjustmentReason, VariantWithProduct } from '@/types';

type Mode = 'single' | 'bulk';

export function AdjustScreen() {
  const [mode, setMode] = useState<Mode>('single');
  const settings = useApi(() => api.settings.get(), []);
  const allowNegative = settings.data?.allowNegativeStock ?? false;
  return (
    <>
      <PageHeader title="Adjust stock" compactTitle="Adjust" crumbs={[{ label: 'Stock', href: '/stock/movements' }, { label: 'Adjust' }]}
        actions={<Segmented aria-label="Adjustment mode" value={mode} onChange={setMode} options={[{ value: 'single', label: 'Single' }, { value: 'bulk', label: 'Bulk' }]} />} />
      <Page>
        {mode === 'single' ? <SingleAdjust allowNegative={allowNegative} /> : <BulkAdjust allowNegative={allowNegative} />}
      </Page>
    </>
  );
}

/* ---------- Single ---------- */
type Calc = 'set' | 'delta';

function SingleAdjust({ allowNegative }: { allowNegative: boolean }) {
  const auth = useAuth();
  const { toast } = useToast();
  const [variant, setVariant] = useState<VariantWithProduct>();
  const [calc, setCalc] = useState<Calc>('set');
  const [after, setAfter] = useState(0);
  const [reason, setReason] = useState<AdjustmentReason>('CORRECTION');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);

  const before = variant?.quantity ?? 0;
  const delta = after - before;
  const negative = after < 0 && !allowNegative;
  const valueDelta = variant?.costPrice !== undefined ? delta * variant.costPrice : undefined;
  const title = variant ? variantTitle(variant.product.name, variant.size, variant.color.name) : '';

  const pick = (v: VariantWithProduct) => { setVariant(v); setAfter(v.quantity); };
  const reset = () => { setVariant(undefined); setAfter(0); setNote(''); setReason('CORRECTION'); setConfirm(false); };

  const adjust = useMutation(() => api.stock.adjust([{ variantId: variant?.id ?? '', newQty: after, reason, note: note.trim() || undefined }]));
  const apply = async () => {
    try {
      await adjust.mutate();
      toast({ kind: 'success', title: 'Adjustment applied', body: `${title} · ${before} → ${after} (${signedQty(delta)})` });
      reset();
    } catch (e) { toast({ kind: 'error', title: "Couldn't apply the adjustment", body: (e as Error).message }); }
  };

  return (
    <>
      <Card as="section" aria-labelledby="adj-single" className="flex max-w-[760px] flex-col gap-4">
        <h2 id="adj-single" className="text-[15px] font-semibold">Single adjustment</h2>
        <Field label="Variant">
          {variant ? (
            <div className="flex min-h-12 items-center gap-3 rounded-input border border-line bg-surface px-3">
              <VariantRow className="flex-1" v={{ name: variant.product.name, size: variant.size, color: variant.color, sku: variant.sku }} trailing={<Badge tone={variant.quantity <= 0 ? 'danger' : variant.quantity <= variant.lowStockThreshold ? 'warn' : 'neutral'}>{variant.quantity} on hand</Badge>} />
              <Button size="sm" variant="ghost" onClick={reset}>Change</Button>
            </div>
          ) : <VariantSearch onPick={pick} size="lg" autoFocus placeholder="Search variant, SKU or scan barcode" />}
        </Field>

        <Segmented aria-label="Mode" grow value={calc} onChange={setCalc} options={[{ value: 'set', label: 'Set new quantity' }, { value: 'delta', label: 'Add / remove (delta)' }]} />

        <div className="flex items-center gap-3 md:gap-4">
          <KpiCard compact className="flex-1" label="Before" value={variant ? formatNumber(before) : '—'} />
          <ArrowRight className="size-5 shrink-0 text-ink-3" aria-hidden />
          <div className={cn('flex min-w-0 flex-1 flex-col gap-1.5 rounded-card border bg-surface px-3.5 py-3', variant ? 'border-accent' : 'border-line')}>
            <p className="eyebrow">After</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={cn('tabular text-xl font-semibold leading-none', negative && 'text-danger-ink')}>{variant ? formatNumber(after) : '—'}</p>
              {calc === 'set'
                ? <QuantityInput size="sm" value={after} min={allowNegative ? -9999 : 0} onChange={setAfter} disabled={!variant} aria-label="New quantity" />
                : <QuantityInput size="sm" value={delta} min={allowNegative ? -9999 : -before} onChange={(d) => setAfter(before + d)} disabled={!variant} aria-label="Change in quantity" />}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Reason" htmlFor="a-reason"><Select id="a-reason" value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason)}>{REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}</Select></Field>
          <Field label="Note" htmlFor="a-note"><Input id="a-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Stain on sleeve, written off" /></Field>
        </div>

        {variant && <ImpactBanner delta={delta} valueDelta={valueDelta} negative={negative} showValue={auth.isManager} />}

        <div className="flex justify-end gap-2">
          <Button onClick={reset} disabled={!variant}>Cancel</Button>
          <Button variant="primary" disabled={!variant || delta === 0 || negative} onClick={() => setConfirm(true)}>Apply adjustment</Button>
        </div>
      </Card>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void apply()} pending={adjust.pending} title="Apply adjustment?" confirmLabel="Apply"
        description={`${title}: ${before} → ${after} (${signedQty(delta)}) · ${REASON_LABEL[reason]}${note.trim() ? ` · “${note.trim()}”` : ''}. Recorded as an ADJUSTMENT movement under your name.`} />
    </>
  );
}

export function ImpactBanner({ delta, valueDelta, negative, showValue }: { delta: number; valueDelta: number | undefined; negative: boolean; showValue: boolean }) {
  const cls = negative || delta < 0 ? 'bg-danger-soft text-danger-ink' : delta > 0 ? 'bg-ok-soft text-ok-ink' : 'bg-surface-2 text-ink-2';
  return (
    <div role="status" className={cn('flex items-center gap-2 rounded-input px-3 py-2.5 text-sm', cls)}>
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      {negative ? 'Negative stock is off in Settings' : delta === 0 ? 'No change yet' : (
        <span className="tabular">Δ {signedQty(delta)} unit{Math.abs(delta) === 1 ? '' : 's'}{showValue && valueDelta !== undefined && <> · stock value {formatMoney(valueDelta, 'EGP', { signed: true })} at cost</>}</span>
      )}
    </div>
  );
}
