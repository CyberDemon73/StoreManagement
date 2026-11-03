'use client';
/**
 * Screen: /my-sales · Roles: SELLER (sales.read; the API scopes the list to the caller)
 * Calls: GET /sales?from&to · GET /settings (receipt header/footer)
 * Tap a sale → Panel with items, totals, Receipt (Dialog + Print) and "Start return" link.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Printer, Receipt as ReceiptIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { listAllPages } from '@/lib/paging';
import { dateRangeFor, formatDateTime, formatMoney, formatNumber, formatTime, PAYMENT_LABEL } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Receipt } from '@/components/app/Receipt';
import { Button, LinkButton } from '@/components/ui/Button';
import { SaleStatusBadge, Thumb } from '@/components/ui/Badge';
import { KpiCard } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Field';
import { Dialog, Panel } from '@/components/ui/Overlay';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import type { DateRangePreset, Sale } from '@/types';

type Preset = Extract<DateRangePreset, 'today' | '7d' | '30d'>;
const PRESETS: { value: Preset; label: string }[] = [{ value: 'today', label: 'Today' }, { value: '7d', label: '7d' }, { value: '30d', label: '30d' }];

export function MySalesScreen() {
  const [preset, setPreset] = useState<Preset>('today');
  const range = useMemo(() => dateRangeFor(preset), [preset]);
  const sales = useApi(() => listAllPages((page, pageSize) => api.sales.list({ from: range.from, to: range.to, page, pageSize })), [range.from, range.to]);
  const settings = useApi(() => api.settings.get(), []);
  const params = useSearchParams();
  const router = useRouter();
  const [openId, setOpenId] = useState<string | undefined>(params.get('open') ?? undefined);
  const [receiptOpen, setReceiptOpen] = useState(false);
  useEffect(() => { const id = params.get('open'); if (id) setOpenId(id); }, [params]);

  const rows = sales.data?.data ?? [];
  const live = rows.filter((s) => s.status !== 'VOID');
  const revenue = live.reduce((a, s) => a + s.total, 0);
  const open = rows.find((s) => s.id === openId);
  const close = () => { setOpenId(undefined); setReceiptOpen(false); if (params.get('open')) router.replace('/my-sales'); };

  return (
    <>
      <PageHeader title="My sales" description={range.label} actions={<Segmented aria-label="Period" value={preset} onChange={setPreset} options={PRESETS} />} />
      <Page className="max-w-[720px] gap-3">
        <section aria-label="Totals" className="grid grid-cols-2 gap-2.5">
          <KpiCard compact label="Sales" value={sales.data ? formatNumber(live.length) : '—'} loading={sales.initial} />
          <KpiCard compact label="Revenue" value={sales.data ? formatMoney(revenue, 'EGP', { compact: true }) : '—'} loading={sales.initial} sub="EGP" />
        </section>

        {sales.initial ? <div className="flex flex-col gap-2.5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[68px] rounded-card" />)}</div>
          : sales.error && !sales.data ? <ErrorState error={sales.error} onRetry={() => void sales.refetch()} />
          : rows.length === 0 ? <EmptyState icon={<ReceiptIcon aria-hidden />} title={`No sales ${preset === 'today' ? 'today' : `in the last ${preset === '7d' ? '7' : '30'} days`}`} body="Sales you complete will show here." action={<LinkButton href="/sell" variant="primary">New sale</LinkButton>} />
          : (
            <ul className="flex flex-col gap-2.5">
              {rows.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setOpenId(s.id)} aria-haspopup="dialog" className="flex min-h-[68px] w-full items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-3 text-left hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="tabular font-semibold">{s.number}</p>
                      <p className="truncate text-xs text-ink-2">{preset === 'today' ? formatTime(s.createdAt) : formatDateTime(s.createdAt)} · {s.items.length} item{s.items.length === 1 ? '' : 's'} · {PAYMENT_LABEL[s.paymentMethod]}{s.customerName ? ` · ${s.customerName}` : ''}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1"><span className="tabular font-semibold">{formatMoney(s.total)}</span><SaleStatusBadge status={s.status} /></div>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </Page>

      <Panel open={!!open} onClose={close} title={open ? <span className="tabular">{open.number}</span> : undefined} description={open ? `${formatDateTime(open.createdAt)} · ${PAYMENT_LABEL[open.paymentMethod]} · ${open.customerName ?? 'Walk-in'}` : undefined} headerAction={open ? <SaleStatusBadge status={open.status} /> : undefined}
        footer={open ? (
          <div className="grid grid-cols-2 gap-2 pb-1">
            <Button size="lg" leading={<ReceiptIcon />} onClick={() => setReceiptOpen(true)}>Receipt</Button>
            <LinkButton size="lg" href={`/sales/${open.id}/return`} disabled={open.status === 'REFUNDED' || open.status === 'VOID'}>Start return</LinkButton>
          </div>
        ) : undefined}>
        {open && <SaleDetail sale={open} />}
      </Panel>

      <Dialog open={receiptOpen && !!open} onClose={() => setReceiptOpen(false)} title="Receipt" footer={<div className="flex justify-end gap-2 no-print"><Button onClick={() => setReceiptOpen(false)}>Close</Button><Button variant="primary" leading={<Printer />} onClick={() => window.print()}>Print</Button></div>}>
        {open && <Receipt sale={open} settings={settings.data} />}
      </Dialog>
    </>
  );
}

function SaleDetail({ sale }: { sale: Sale }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {sale.items.map((it) => (
          <li key={it.id} className="flex min-h-12 items-center gap-3 border-b border-line py-2.5 last:border-0">
            <Thumb tint={it.tint} size="md" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{it.productName}</p><p className="text-xs text-ink-2">{it.size} · {it.color.name} · ×{it.qty}{it.returnedQty > 0 ? ` · ${it.returnedQty} returned` : ''}</p></div>
            <span className="tabular text-sm">{formatMoney(it.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[13px]">
        <div className="flex justify-between"><span className="text-ink-2">Subtotal</span><span className="tabular">{formatMoney(sale.subtotal)}</span></div>
        {sale.discount > 0 && <div className="flex justify-between"><span className="text-ink-2">Discount{sale.discountPct ? ` ${sale.discountPct}%` : ''}</span><span className="tabular">−{formatMoney(sale.discount)}</span></div>}
        <div className="flex justify-between text-[15px] font-semibold"><span>Total</span><span className="tabular">{formatMoney(sale.total)}</span></div>
      </div>
      {sale.note && <p className="text-sm text-ink-2">Note: {sale.note}</p>}
    </div>
  );
}
