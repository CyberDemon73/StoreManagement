'use client';
/**
 * Variant editor opened from the product matrix. Sheet on mobile, drawer otherwise.
 * Calls: PATCH /variants/:id (cost, price, SKU, barcode, threshold) · POST /stock/adjustments
 * (managers only; new quantity + reason + note). Sellers see read-only values and no cost.
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatMoney, formatPct, marginPct, REASON_LABEL, stockStatus } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Field, Input, MoneyInput, Select } from '@/components/ui/Field';
import { QuantityInput } from '@/components/ui/Controls';
import { ColorSwatch, StockBadge } from '@/components/ui/Badge';
import { Divider } from '@/components/ui/Card';
import { Panel } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import type { AdjustmentReason, Variant } from '@/types';

const REASONS: AdjustmentReason[] = ['CORRECTION', 'DAMAGED', 'LOST', 'FOUND', 'OTHER'];

export function VariantEditorPanel({ variant, open, onClose, onSaved }: { variant: Variant | undefined; open: boolean; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const auth = useAuth();
  const { toast } = useToast();
  const canEdit = auth.can('variants.write');
  const canAdjust = auth.can('stock.adjust');
  const showCost = auth.isManager;

  const [cost, setCost] = useState<number | undefined>();
  const [price, setPrice] = useState<number | undefined>();
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [threshold, setThreshold] = useState(0);
  const [newQty, setNewQty] = useState(0);
  const [reason, setReason] = useState<AdjustmentReason>('CORRECTION');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!variant) return;
    setCost(variant.costPrice); setPrice(variant.sellPrice); setSku(variant.sku); setBarcode(variant.barcode ?? ''); setThreshold(variant.lowStockThreshold); setNewQty(variant.quantity); setReason('CORRECTION'); setNote(''); setErrors({});
  }, [variant]);

  if (!variant) return null;
  const v = variant;
  const st = stockStatus(v.quantity, v.lowStockThreshold);
  const margin = marginPct(price ?? 0, showCost ? cost : undefined);
  const qtyChanged = newQty !== v.quantity;
  const patch: Parameters<typeof api.variants.update>[1] = {};
  if (showCost && cost !== undefined && cost !== v.costPrice) patch.costPrice = cost;
  if (price !== undefined && price !== v.sellPrice) patch.sellPrice = price;
  if (sku.trim() && sku.trim() !== v.sku) patch.sku = sku.trim();
  if ((barcode.trim() || undefined) !== v.barcode) patch.barcode = barcode.trim() || undefined;
  if (threshold !== v.lowStockThreshold) patch.lowStockThreshold = threshold;
  const hasPatch = Object.keys(patch).length > 0;
  const dirty = hasPatch || (canAdjust && qtyChanged);

  const save = async () => {
    const errs: Record<string, string> = {};
    if (price === undefined || price <= 0) errs.price = 'Sell price must be more than 0';
    if (!sku.trim()) errs.sku = 'SKU is required';
    if (threshold < 0) errs.threshold = 'Threshold cannot be negative';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    try {
      if (hasPatch) await api.variants.update(v.id, patch);
      if (canAdjust && qtyChanged) await api.stock.adjust([{ variantId: v.id, newQty, reason, note: note.trim() || undefined }]);
      await onSaved();
      toast({ kind: 'success', title: `${v.size} · ${v.color.name} saved`, body: qtyChanged && canAdjust ? `Quantity ${v.quantity} → ${newQty} · ${REASON_LABEL[reason]}` : undefined });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      toast({ kind: 'error', title: "Couldn't save the variant", body: (e as Error).message });
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel open={open} onClose={onClose} title={`${v.size} · ${v.color.name}`} description="Variant"
      footer={canEdit ? <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={pending} disabled={!dirty} onClick={() => void save()}>Save changes</Button></div> : undefined}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <ColorSwatch hex={v.color.hex} name={v.color.name} size="md" />
          <div className="min-w-0 flex-1"><p className="tabular truncate text-sm font-semibold">{v.sku}</p><p className="tabular text-xs text-ink-2">Barcode {v.barcode ?? '—'}</p></div>
          <StockBadge status={st} qty={v.quantity} />
        </div>

        {canEdit ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {showCost && <Field label="Cost price" htmlFor="v-cost" error={errors.costPrice}><MoneyInput id="v-cost" value={cost} onChange={setCost} /></Field>}
            <Field label="Sell price" htmlFor="v-price" error={errors.price ?? errors.sellPrice} help={margin !== undefined ? `Margin ${formatPct(margin)}` : undefined}><MoneyInput id="v-price" value={price} onChange={setPrice} invalid={!!errors.price} /></Field>
            <Field label="SKU" htmlFor="v-sku" error={errors.sku}><Input id="v-sku" value={sku} onChange={(e) => setSku(e.target.value)} invalid={!!errors.sku} className="tabular" /></Field>
            <Field label="Barcode" htmlFor="v-bar" error={errors.barcode}><Input id="v-bar" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} className="tabular" /></Field>
            <Field label="Low-stock threshold" htmlFor="v-thr" error={errors.threshold ?? errors.lowStockThreshold}><Input id="v-thr" type="number" min={0} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(Math.max(0, parseInt(e.target.value || '0', 10)))} align="right" /></Field>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="eyebrow">Price</dt><dd className="tabular font-semibold">{formatMoney(v.sellPrice, 'EGP', { withCurrency: true })}</dd></div>
            <div><dt className="eyebrow">Quantity</dt><dd className="tabular font-semibold">{v.quantity}</dd></div>
            <div><dt className="eyebrow">SKU</dt><dd className="tabular">{v.sku}</dd></div>
            <div><dt className="eyebrow">Threshold</dt><dd className="tabular">{v.lowStockThreshold}</dd></div>
          </dl>
        )}

        {canAdjust && (
          <>
            <Divider />
            <section className="flex flex-col gap-3">
              <div><p className="text-sm font-semibold">Adjust quantity</p><p className="text-xs text-ink-2">Creates an ADJUSTMENT movement with your name.</p></div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm"><span className="text-ink-2">Current </span><span className="tabular font-semibold" aria-live="polite">{v.quantity}</span>{qtyChanged && <span className="tabular ml-2 text-xs text-ink-2">→ {newQty} ({newQty - v.quantity > 0 ? '+' : ''}{newQty - v.quantity})</span>}</div>
                <QuantityInput value={newQty} onChange={setNewQty} aria-label="New quantity" />
              </div>
              <Field label="Reason" htmlFor="v-reason"><Select id="v-reason" value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason)}>{REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}</Select></Field>
              <Field label="Note (optional)" htmlFor="v-note"><Input id="v-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. found 2 in the back room" /></Field>
            </section>
          </>
        )}
        {!canAdjust && <p className="text-xs text-ink-2">Sellers can&apos;t adjust stock. Ask a manager to correct a quantity.</p>}
      </div>
    </Panel>
  );
}
