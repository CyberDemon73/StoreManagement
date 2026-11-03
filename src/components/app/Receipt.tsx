'use client';
import { formatMoney, formatDate, formatTime, PAYMENT_LABEL } from '@/lib/format';
import { cn } from '@/lib/cn';
import { LogoMark } from './Brand';
import type { Sale, Settings } from '@/types';

/** Print-friendly receipt (80 mm roll). Wrap in `.print-area` to be the only thing printed. */
export function Receipt({ sale, settings, className }: { sale: Sale; settings?: Pick<Settings, 'storeName' | 'receiptHeader' | 'receiptFooter' | 'receiptShowLogo' | 'currency'>; className?: string }) {
  const s = settings ?? { storeName: 'Avenue', receiptHeader: 'Tagamo3 · 02 2735 1180', receiptFooter: 'Exchanges within 14 days with receipt. Thank you.', receiptShowLogo: true, currency: 'EGP' };
  return (
    <div className={cn('print-area mx-auto w-full max-w-[320px] rounded-card border border-line bg-white p-4 font-mono text-[12px] leading-relaxed text-[#1F2421] print:max-w-none print:border-0 print:p-0', className)}>
      {s.receiptShowLogo && <div className="mb-1 flex flex-col items-center gap-1"><LogoMark size={28} variant="mono" className="text-[#1F2421]" /><p className="text-center text-[14px] font-bold tracking-wide">{s.storeName.toUpperCase()} STOCK</p></div>}
      {s.receiptHeader && <p className="text-center">{s.receiptHeader}</p>}
      <p className="text-center">{sale.number} · {formatDate(sale.createdAt, 'DD/MM/YYYY')} {formatTime(sale.createdAt)}</p>
      <hr className="my-2 border-dashed border-[#9AA09B]" />
      {sale.items.map((it) => (
        <div key={it.id} className="flex justify-between gap-2"><span className="min-w-0 flex-1 truncate">{it.productName} {it.size}·{it.color.name} ×{it.qty}</span><span className="tabular">{formatMoney(it.lineTotal)}</span></div>
      ))}
      <hr className="my-2 border-dashed border-[#9AA09B]" />
      <div className="flex justify-between"><span>Subtotal</span><span className="tabular">{formatMoney(sale.subtotal)}</span></div>
      {sale.discount > 0 && <div className="flex justify-between"><span>Discount{sale.discountPct ? ` ${sale.discountPct}%` : ''}</span><span className="tabular">−{formatMoney(sale.discount)}</span></div>}
      <div className="flex justify-between text-[14px] font-bold"><span>TOTAL {s.currency}</span><span className="tabular">{formatMoney(sale.total)}</span></div>
      <div className="flex justify-between"><span>Paid · {PAYMENT_LABEL[sale.paymentMethod]}</span><span className="tabular">{formatMoney(sale.total)}</span></div>
      {sale.status !== 'COMPLETED' && <p className="mt-1 font-bold">{sale.status === 'VOID' ? '*** VOID ***' : sale.status === 'REFUNDED' ? '*** REFUNDED ***' : '*** PARTIALLY REFUNDED ***'}</p>}
      <p className="mt-2">Seller: {sale.sellerName} · Customer: {sale.customerName ?? 'Walk-in'}</p>
      {s.receiptFooter && <p className="mt-2 whitespace-pre-line text-center">{s.receiptFooter}</p>}
      <div aria-hidden className="mx-auto mt-3 h-10 w-3/4" style={{ background: 'repeating-linear-gradient(90deg,#1F2421 0 2px,transparent 2px 4px,#1F2421 4px 5px,transparent 5px 8px)' }} />
      <p className="tabular text-center text-[10px]">{sale.number}</p>
    </div>
  );
}

/** Barcode label card for the Labels screen. */
export function LabelCard({ name, variant, sku, barcode, price, showPrice = true, showVariant = true, thermal, showLogo }: { name: string; variant: string; sku: string; barcode?: string; price: number; showPrice?: boolean; showVariant?: boolean; thermal?: boolean; showLogo?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-0.5 rounded border border-dashed border-line bg-white p-2 text-[9px] leading-tight text-[#1F2421] print:border-0', thermal ? 'h-[30mm] w-[40mm]' : 'min-h-[80px]')}>
      <p className="flex items-center gap-1 truncate text-[10px] font-semibold">{showLogo && <LogoMark size={10} variant="mono" className="text-[#3F6B5C]" />}<span className="truncate">{name}</span></p>
      {showVariant && <p className="truncate text-[#5B625D]">{variant} · {sku}</p>}
      <div aria-hidden className="my-1 h-6" style={{ background: 'repeating-linear-gradient(90deg,#1F2421 0 1px,transparent 1px 3px,#1F2421 3px 5px,transparent 5px 7px,#1F2421 7px 8px,transparent 8px 11px)' }} />
      <div className="flex items-end justify-between"><span className="tabular text-[#5B625D]">{barcode ?? sku}</span>{showPrice && <span className="tabular text-[11px] font-bold">{formatMoney(price, 'EGP', { withCurrency: true, compact: true })}</span>}</div>
    </div>
  );
}
