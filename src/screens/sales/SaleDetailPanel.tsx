'use client';
/** Sale detail panel for /sales?open=ID: items, totals, meta, print / share / return / void (GET /sales/:id · POST /sales/:id/void · GET /settings for the receipt). */
import { useState } from 'react';
import { Printer, Share2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatMoney, formatPct, formatTime, PAYMENT_LABEL } from '@/lib/format';
import { Button, LinkButton } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { ColorSwatch, SaleStatusBadge, Thumb } from '@/components/ui/Badge';
import { Dialog, Panel } from '@/components/ui/Overlay';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { Receipt } from '@/components/app/Receipt';
import type { Sale } from '@/types';

export function SaleDetailPanel({ saleId, fallback, onClose, onChanged }: { saleId: string | undefined; fallback?: Sale; onClose: () => void; onChanged: (s: Sale) => void }) {
  const auth = useAuth();
  const { toast } = useToast();
  const detail = useApi(() => api.sales.get(saleId ?? ''), [saleId], { enabled: !!saleId });
  const sale = detail.data?.id === saleId ? detail.data : fallback;
  const [printOpen, setPrintOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const settings = useApi(() => api.settings.get(), [], { enabled: printOpen });

  const voidSale = useMutation((id: string, reason: string) => api.sales.void(id, reason));
  const onVoid = async () => {
    if (!sale) return;
    try { const s = await voidSale.mutate(sale.id, voidReason.trim()); setVoidOpen(false); setVoidReason(''); toast({ kind: 'success', title: `${sale.number} voided`, body: 'Stock movements were reversed.' }); if (s) { detail.setData(s); onChanged(s); } }
    catch (e) { toast({ kind: 'error', title: "Couldn't void the sale", body: (e as Error).message }); }
  };
  const share = async () => {
    if (!sale) return;
    const url = `${location.origin}/sales?open=${sale.id}`;
    const text = `${sale.number} · ${formatMoney(sale.total, 'EGP', { withCurrency: true })} · ${formatDateTime(sale.createdAt)}`;
    try { if (navigator.share) await navigator.share({ title: sale.number, text, url }); else { await navigator.clipboard.writeText(url); toast({ kind: 'success', title: 'Link copied' }); } }
    catch { /* user cancelled */ }
  };

  const refunded = sale?.returns.reduce((a, r) => a + r.refundAmount, 0) ?? 0;
  const canReturn = !!sale && sale.status !== 'VOID' && sale.status !== 'REFUNDED' && auth.can('returns.create');
  const canVoid = !!sale && sale.status === 'COMPLETED' && auth.can('sales.void');
  const margin = sale?.profit !== undefined && sale.total > 0 ? (sale.profit / sale.total) * 100 : undefined;

  return (
    <>
      <Panel open={!!saleId} onClose={onClose} width="lg" title={sale ? <span className="tabular">{sale.number}</span> : 'Sale'} description={sale ? `${formatDate(sale.createdAt)} ${sale.createdAt.slice(0, 4)} · ${formatTime(sale.createdAt)} · ${sale.sellerName}` : undefined} headerAction={sale ? <SaleStatusBadge status={sale.status} /> : undefined}>
        {!sale ? (detail.error ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} compact /> : <SkeletonRows rows={4} />) : (
          <div className="flex flex-col gap-4">
            {sale.status === 'VOID' && <p className="rounded-input bg-danger-soft px-3 py-2 text-sm text-danger-ink">Voided{sale.voidReason ? ` · “${sale.voidReason}”` : ''}. All stock movements were reversed.</p>}
            <ul className="flex flex-col divide-y divide-line">
              {sale.items.map((it) => (
                <li key={it.id} className={cn('flex items-center gap-3 py-2.5 text-sm', it.returnedQty >= it.qty && 'opacity-60')}>
                  <Thumb tint={it.tint} size="md" />
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{it.productName}</p><p className="flex items-center gap-1.5 text-xs text-ink-2"><ColorSwatch hex={it.color.hex} name={it.color.name} size="xs" />{it.size} · {it.color.name} · <span className="tabular">{it.sku}</span></p>{it.returnedQty > 0 && <p className="text-xs text-info-ink">{it.returnedQty} of {it.qty} returned</p>}</div>
                  <span className="tabular text-xs text-ink-2">{it.qty} × {formatMoney(it.unitPrice)}</span>
                  <span className="tabular w-20 text-right font-semibold">{formatMoney(it.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3.5 py-3 text-[13px]">
              <Row label="Subtotal" value={formatMoney(sale.subtotal)} />
              {sale.discount > 0 && <Row label={`Discount${sale.discountPct ? ` ${sale.discountPct}%` : ''}`} value={`−${formatMoney(sale.discount)}`} />}
              <div className="flex justify-between text-[15px] font-semibold"><span>Total</span><span className={cn('tabular', sale.status === 'VOID' && 'line-through')}>{formatMoney(sale.total)}</span></div>
              <Row label={`Paid · ${PAYMENT_LABEL[sale.paymentMethod]}`} value={formatMoney(sale.total)} />
              {refunded > 0 && <Row label={`Refunded · ${sale.returns.length} return${sale.returns.length === 1 ? '' : 's'}`} value={<span className="text-info-ink">−{formatMoney(refunded)}</span>} />}
              {auth.isManager && sale.cost !== undefined && sale.profit !== undefined && <Row label="Cost · Profit" value={<>{formatMoney(sale.cost)} · <span className={sale.profit >= 0 ? 'text-ok-ink' : 'text-danger-ink'}>{formatMoney(sale.profit)}{margin !== undefined ? ` (${formatPct(margin)})` : ''}</span></>} />}
            </div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[13px]">
              <dt className="text-ink-2">Customer</dt><dd>{sale.customerName ?? 'Walk-in'}{sale.customerPhone ? <span className="tabular text-ink-2"> · {sale.customerPhone}</span> : ''}</dd>
              <dt className="text-ink-2">Note</dt><dd className={sale.note ? '' : 'text-ink-2'}>{sale.note ?? '—'}</dd>
              <dt className="text-ink-2">Created</dt><dd className="tabular">{formatDateTime(sale.createdAt)}</dd>
              <dt className="text-ink-2">Device</dt><dd className={sale.device ? '' : 'text-ink-2'}>{sale.device ?? '—'}</dd>
            </dl>
            <div className="grid grid-cols-2 gap-2">
              <Button leading={<Printer />} onClick={() => setPrintOpen(true)}>Print receipt</Button>
              <Button leading={<Share2 />} onClick={() => void share()}>Share</Button>
              {canReturn ? <LinkButton href={`/sales/${sale.id}/return`}>Return items</LinkButton> : <Button disabled>Return items</Button>}
              {auth.can('sales.void') && <Button variant="dangerSoft" disabled={!canVoid} onClick={() => setVoidOpen(true)}>Void (manager)</Button>}
            </div>
            <p className="text-xs text-ink-2">Void requires a reason and reverses all stock movements. Returns can be partial.</p>
          </div>
        )}
      </Panel>

      <Dialog open={printOpen} onClose={() => setPrintOpen(false)} title="Receipt" description="80 mm roll · opens the browser print dialog." className="no-print-wrapper"
        footer={<><Button onClick={() => setPrintOpen(false)}>Close</Button><Button variant="primary" leading={<Printer />} onClick={() => window.print()} data-autofocus>Print</Button></>}>
        {sale && <Receipt sale={sale} settings={settings.data} />}
      </Dialog>

      <Dialog open={voidOpen} onClose={() => setVoidOpen(false)} danger title={`Void ${sale?.number ?? 'sale'}?`} description="This reverses every stock movement of the sale and marks it Void. It cannot be undone."
        footer={<><Button onClick={() => setVoidOpen(false)}>Cancel</Button><Button variant="danger" disabled={voidReason.trim().length < 3} loading={voidSale.pending} onClick={() => void onVoid()}>Void sale</Button></>}>
        <Field label="Reason" htmlFor="void-reason" help="Required · shown in the Audit log."><Input id="void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Duplicate entry" data-autofocus /></Field>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-ink-2">{label}</span><span className="tabular">{value}</span></div>;
}
