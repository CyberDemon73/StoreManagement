'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Textarea, Toggle } from '@/components/ui/Field';
import { Dialog } from '@/components/ui/Overlay';
import { Skeleton } from '@/components/ui/States';
import { Receipt } from '@/components/app/Receipt';
import type { SectionProps } from './shared';

export function SalesSection({ draft, patch }: SectionProps) {
  return (
    <Card as="section" id="s-sales" className="flex flex-col gap-3" aria-labelledby="s-sales-h">
      <CardHeader id="s-sales-h" title="Sales" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sale number prefix" htmlFor="sl-pre" help={<span className="tabular">Next: {draft.saleNumberPrefix}{draft.nextSaleNumber}</span>}>
          <Input id="sl-pre" value={draft.saleNumberPrefix} onChange={(e) => patch({ saleNumberPrefix: e.target.value.toUpperCase() })} maxLength={6} />
        </Field>
        <Field label="Seller discount cap" htmlFor="sl-cap" help="Managers are not capped.">
          <Input id="sl-cap" type="number" inputMode="numeric" min={0} max={100} align="right" value={draft.sellerDiscountCapPct} onChange={(e) => patch({ sellerDiscountCapPct: Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)) })} trailing={<span className="text-sm">%</span>} />
        </Field>
      </div>
      <Toggle checked={draft.allowNegativeStock} onChange={(v) => patch({ allowNegativeStock: v })} label="Allow negative stock" description={draft.allowNegativeStock ? 'On · a sale may take a variant below 0.' : 'Off · a sale cannot take a variant below 0.'} />
      <Toggle checked={draft.requirePhoneOnTransfer} onChange={(v) => patch({ requirePhoneOnTransfer: v })} label="Ask for customer phone on Transfer payments" />
    </Card>
  );
}

export function ReceiptSection({ draft, patch }: SectionProps) {
  const [preview, setPreview] = useState(false);
  const sample = useApi(() => api.sales.list({ pageSize: 1 }), [preview], { enabled: preview });
  const sale = sample.data?.data[0];
  return (
    <Card as="section" id="s-rec" className="flex flex-col gap-3" aria-labelledby="s-rec-h">
      <CardHeader id="s-rec-h" title="Receipt" />
      <Field label="Header text" htmlFor="rc-h"><Input id="rc-h" value={draft.receiptHeader ?? ''} onChange={(e) => patch({ receiptHeader: e.target.value })} /></Field>
      <Field label="Footer text" htmlFor="rc-f"><Textarea id="rc-f" className="min-h-[60px]" value={draft.receiptFooter ?? ''} onChange={(e) => patch({ receiptFooter: e.target.value })} /></Field>
      <div className="flex items-center gap-3">
        <Toggle checked={draft.receiptShowLogo} onChange={(v) => patch({ receiptShowLogo: v })} label="Show logo" />
        <Button size="sm" className="ml-auto" onClick={() => setPreview(true)}>Preview receipt</Button>
      </div>
      <Dialog open={preview} onClose={() => setPreview(false)} title="Receipt preview" description="Uses your most recent sale with the settings above.">
        {sample.error && !sale ? <p className="text-sm text-danger-ink">Couldn&apos;t load a sample sale. {sample.error.message}</p> : !sample.data ? <Skeleton className="mx-auto h-72 w-full max-w-[320px] rounded-card" /> : sale ? <Receipt sale={sale} settings={{ storeName: draft.storeName, receiptHeader: draft.receiptHeader, receiptFooter: draft.receiptFooter, receiptShowLogo: draft.receiptShowLogo, currency: draft.currency }} /> : <p className="text-sm text-ink-2">No sales yet to preview. Make a sale first.</p>}
      </Dialog>
    </Card>
  );
}
