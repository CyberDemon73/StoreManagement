'use client';
/**
 * Screen: /sales/[id]/return · Roles: ADMIN, MANAGER, SELLER (own sales; returns.create)
 * Calls: GET /sales/:id · POST /sales/:id/returns
 * Each line: qty to return (max sold − already returned) + restock toggle. Refund = unitPrice × qty × (1 − discount%).
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useApi, useBreakpoint, useMutation } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatMoney, PAYMENT_LABEL } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox, Field, Input, Segmented, Select, Toggle } from '@/components/ui/Field';
import { QuantityInput } from '@/components/ui/Controls';
import { Badge, ColorSwatch } from '@/components/ui/Badge';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import type { PaymentMethod, Sale, SaleItem } from '@/types';

interface LineState { sel: boolean; qty: number; restock: boolean }
const REASONS = ['Wrong size', 'Changed mind', 'Defective', 'Other'] as const;
const METHODS: PaymentMethod[] = ['CASH', 'CARD', 'WALLET', 'TRANSFER'];
const TH = 'whitespace-nowrap border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2';
const TD = 'border-b border-line px-3 py-2.5 align-middle group-last:border-0';

export function ReturnScreen({ saleId }: { saleId: string }) {
  const router = useRouter();
  const bp = useBreakpoint();
  const { toast } = useToast();
  const sale = useApi(() => api.sales.get(saleId), [saleId]);
  const s = sale.data;
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [method, setMethod] = useState<PaymentMethod>();
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [note, setNote] = useState('');

  useEffect(() => { if (s) { setLines(Object.fromEntries(s.items.map((it) => [it.id, { sel: false, qty: 0, restock: true }]))); setMethod(s.paymentMethod); } }, [s]);

  const discountPct = s ? (s.discountPct ?? (s.subtotal > 0 ? (s.discount / s.subtotal) * 100 : 0)) : 0;
  const refundFor = (it: SaleItem, qty: number) => Math.round(it.unitPrice * qty * (1 - discountPct / 100));
  const remaining = (it: SaleItem) => it.qty - it.returnedQty;
  const refundedOn = (it: SaleItem) => s?.returns.find((r) => r.items.some((x) => x.saleItemId === it.id));
  const set = (id: string, patch: Partial<LineState>) => setLines((ls) => ({ ...ls, [id]: { ...(ls[id] ?? { sel: false, qty: 0, restock: true }), ...patch } }));

  const picked = s ? s.items.map((it) => ({ it, st: lines[it.id] })).filter((x): x is { it: SaleItem; st: LineState } => !!x.st && x.st.sel && x.st.qty > 0) : [];
  const count = picked.reduce((a, x) => a + x.st.qty, 0);
  const restocked = picked.filter((x) => x.st.restock).reduce((a, x) => a + x.st.qty, 0);
  const total = picked.reduce((a, x) => a + refundFor(x.it, x.st.qty), 0);
  const alreadyRefunded = s?.items.filter((it) => it.returnedQty > 0).length ?? 0;
  const closed = !!s && (s.status === 'VOID' || s.status === 'REFUNDED');

  // One Idempotency-Key per return attempt, reused on retry (same contract as checkout).
  const idemKey = useRef<string | undefined>(undefined);
  const create = useMutation(() => api.sales.createReturn(saleId, { items: picked.map((x) => ({ saleItemId: x.it.id, qty: x.st.qty, restock: x.st.restock })), refundMethod: method ?? s?.paymentMethod ?? 'CASH', reason, note: note.trim() || undefined }, (idemKey.current ??= crypto.randomUUID())));
  const confirm = async () => {
    try { await create.mutate(); toast({ kind: 'success', title: `Refund of ${formatMoney(total, 'EGP', { withCurrency: true })} recorded`, body: `${count} item${count === 1 ? '' : 's'} returned · ${restocked} back to stock` }); router.push(`/sales?open=${saleId}`); }
    catch (e) { toast({ kind: 'error', title: "Couldn't record the return", body: (e as Error).message }); }
  };

  const crumbs = [{ label: 'Sales', href: '/sales' }, { label: s?.number ?? '…', href: `/sales?open=${saleId}` }, { label: 'Return items' }];
  const summary = (
    <div className="flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3.5 py-3 text-[13px]">
      <div className="flex justify-between"><span className="text-ink-2">Items returned</span><span className="tabular" aria-live="polite">{count}</span></div>
      <div className="flex justify-between"><span className="text-ink-2">Restocked</span><span className="tabular">{restocked}</span></div>
      <div className="flex justify-between text-base font-semibold"><span>Refund</span><span className="tabular" aria-live="polite">{formatMoney(total, 'EGP', { withCurrency: true })}</span></div>
    </div>
  );

  return (
    <>
      <PageHeader title="Return items" compactTitle={s ? `Return · ${s.number}` : 'Return'} crumbs={crumbs} back={`/sales?open=${saleId}`} />
      <Page>
        {sale.error && !s ? <ErrorState error={sale.error} onRetry={() => void sale.refetch()} /> : !s ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><Skeleton className="h-72 rounded-card" /><Skeleton className="h-96 rounded-card" /></div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card as="section" padded={false} aria-labelledby="rt-h" className="flex min-w-0 flex-col overflow-hidden self-start">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3.5 md:px-5">
                <div className="min-w-0 flex-1"><h2 id="rt-h" className="text-[15px] font-semibold">Items from <span className="tabular">{s.number}</span></h2><p className="text-xs text-ink-2">Sold {formatDateTime(s.createdAt)} by {s.sellerName.split(' ')[0]} · {PAYMENT_LABEL[s.paymentMethod]} · {s.items.reduce((a, i) => a + i.qty, 0)} items · {formatMoney(s.total)}</p></div>
                {closed ? <Badge tone={s.status === 'VOID' ? 'danger' : 'info'} dot>{s.status === 'VOID' ? 'Sale is void' : 'Fully refunded'}</Badge> : alreadyRefunded > 0 && <Badge tone="warn" dot>{alreadyRefunded} item{alreadyRefunded === 1 ? '' : 's'} already refunded</Badge>}
              </div>
              {bp === 'mobile' ? (
                <ul className="flex flex-col divide-y divide-line">
                  {s.items.map((it) => <LineCard key={it.id} it={it} st={lines[it.id]} remaining={remaining(it)} refund={refundFor(it, lines[it.id]?.qty ?? 0)} refundedOn={refundedOn(it)} disabled={closed} onChange={(p) => set(it.id, p)} />)}
                </ul>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-separate border-spacing-0 text-sm" aria-label="Sale items">
                    <thead><tr><th scope="col" className={`${TH} w-11`}><span className="sr-only">Return</span></th><th scope="col" className={TH}>Item</th><th scope="col" className={`${TH} text-right`}>Sold</th><th scope="col" className={TH}>Return qty</th><th scope="col" className={`${TH} text-right`}>Unit price</th><th scope="col" className={`${TH} text-right`}>Refund</th><th scope="col" className={TH}>Restock</th></tr></thead>
                    <tbody>
                      {s.items.map((it) => {
                        const st = lines[it.id];
                        const rem = remaining(it);
                        const done = rem <= 0;
                        const r = refundedOn(it);
                        return (
                          <tr key={it.id} className={cn('group', (done || closed) && 'opacity-55')}>
                            <td className={TD}>{!done && !closed && <Checkbox checked={!!st?.sel} onChange={(on) => set(it.id, { sel: on, qty: on && (st?.qty ?? 0) === 0 ? 1 : st?.qty ?? 0 })} aria-label={`Return ${it.productName}`} />}</td>
                            <td className={TD}><div className="flex items-center gap-2.5"><ColorSwatch hex={it.color.hex} name={it.color.name} /><div className="min-w-0"><p className="truncate text-sm font-medium">{it.productName}</p><p className="text-xs text-ink-2">{it.size} · {it.color.name} · <span className="tabular">{it.sku}</span></p></div></div></td>
                            <td className={`${TD} tabular text-right text-ink-2`}>{it.qty}</td>
                            <td className={TD}>{done ? <span className="text-xs text-ink-2">Refunded{r ? ` ${formatDate(r.createdAt)}` : ''}</span> : <QuantityInput size="sm" value={st?.qty ?? 0} min={0} max={rem} disabled={closed} onChange={(q) => set(it.id, { qty: q, sel: q > 0 })} aria-label={`Return quantity for ${it.productName}`} />}</td>
                            <td className={`${TD} tabular text-right`}>{formatMoney(it.unitPrice)}</td>
                            <td className={`${TD} tabular text-right font-semibold`}>{st?.sel && st.qty > 0 ? formatMoney(refundFor(it, st.qty)) : <span className="font-normal text-ink-2">—</span>}</td>
                            <td className={TD}>{done ? <span className="text-xs text-ink-2">{r?.items.find((x) => x.saleItemId === it.id)?.restock === false ? 'Written off' : 'Restocked'}</span> : <div className="flex items-center gap-2"><Toggle checked={st?.restock ?? true} onChange={(v) => set(it.id, { restock: v })} aria-label={`Restock ${it.productName}`} disabled={closed} /><span className="text-xs text-ink-2">{st?.restock ?? true ? 'Back to stock' : 'Damaged · write off'}</span></div>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card as="aside" aria-label="Refund" className="flex flex-col gap-4 self-start xl:sticky xl:top-20">
              <h2 className="text-[15px] font-semibold">Refund</h2>
              <Field label="Refund method" help={`Original payment was ${PAYMENT_LABEL[s.paymentMethod]}.`}>
                <Segmented aria-label="Refund method" grow size="lg" value={method ?? s.paymentMethod} onChange={setMethod} options={METHODS.map((m) => ({ value: m, label: PAYMENT_LABEL[m] }))} />
              </Field>
              <Field label="Reason" htmlFor="rt-reason"><Select id="rt-reason" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
              <Field label="Note (optional)" htmlFor="rt-note"><Input id="rt-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. exchanged for L" /></Field>
              {summary}
              <Button size="lg" variant="primary" block disabled={count === 0 || closed} loading={create.pending} onClick={() => void confirm()}>Confirm refund · {formatMoney(total, 'EGP', { withCurrency: true })}</Button>
              <LinkButton block href={`/sales?open=${saleId}`}>Cancel</LinkButton>
              <p className="text-xs text-ink-2">Creates RETURN movements for restocked lines and marks the sale Partially refunded or Refunded.</p>
            </Card>
          </div>
        )}
      </Page>
    </>
  );
}

function LineCard({ it, st, remaining, refund, refundedOn, disabled, onChange }: { it: SaleItem; st: LineState | undefined; remaining: number; refund: number; refundedOn: Sale['returns'][number] | undefined; disabled: boolean; onChange: (p: Partial<LineState>) => void }) {
  const done = remaining <= 0;
  return (
    <li className={cn('flex flex-col gap-2.5 px-4 py-3', (done || disabled) && 'opacity-55')}>
      <div className="flex items-start gap-3">
        {!done && !disabled && <Checkbox checked={!!st?.sel} onChange={(on) => onChange({ sel: on, qty: on && (st?.qty ?? 0) === 0 ? 1 : st?.qty ?? 0 })} aria-label={`Return ${it.productName}`} className="mt-1" />}
        <ColorSwatch hex={it.color.hex} name={it.color.name} className="mt-1.5" />
        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{it.productName}</p><p className="text-xs text-ink-2">{it.size} · {it.color.name} · sold {it.qty} × {formatMoney(it.unitPrice)}</p>{done && <p className="text-xs text-ink-2">Refunded{refundedOn ? ` ${formatDate(refundedOn.createdAt)}` : ''}</p>}</div>
        {st?.sel && st.qty > 0 && <span className="tabular text-sm font-semibold">{formatMoney(refund)}</span>}
      </div>
      {!done && (
        <div className="flex flex-wrap items-center gap-3 pl-8">
          <QuantityInput value={st?.qty ?? 0} min={0} max={remaining} disabled={disabled} onChange={(q) => onChange({ qty: q, sel: q > 0 })} aria-label={`Return quantity for ${it.productName}`} />
          <div className="flex items-center gap-2"><Toggle checked={st?.restock ?? true} onChange={(v) => onChange({ restock: v })} aria-label={`Restock ${it.productName}`} disabled={disabled} /><span className="text-xs text-ink-2">{st?.restock ?? true ? 'Back to stock' : 'Damaged · write off'}</span></div>
        </div>
      )}
    </li>
  );
}
