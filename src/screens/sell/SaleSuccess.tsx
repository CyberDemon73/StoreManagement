'use client';
/**
 * Post-charge view on /sell: big check, number · payment · time, total, printable Receipt,
 * Share / Print / New sale. Matches the POS-Success artboard.
 */
import { Check, Printer, Share2 } from 'lucide-react';
import { formatMoney, formatTime, PAYMENT_LABEL } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Receipt } from '@/components/app/Receipt';
import { useToast } from '@/components/ui/Toast';
import type { Sale, Settings } from '@/types';
import { printOrShare } from '@/lib/print-share';

export function receiptText(sale: Sale, storeName = 'Avenue'): string {
  const lines = sale.items.map((i) => `${i.productName} ${i.size}·${i.color.name} ×${i.qty}  ${formatMoney(i.lineTotal)}`);
  return [`${storeName} · ${sale.number}`, ...lines, `Subtotal ${formatMoney(sale.subtotal)}`, sale.discount > 0 ? `Discount −${formatMoney(sale.discount)}` : '', `TOTAL EGP ${formatMoney(sale.total)} · ${PAYMENT_LABEL[sale.paymentMethod]}`].filter(Boolean).join('\n');
}

export function SaleSuccess({ sale, settings, onNew }: { sale: Sale; settings?: Settings; onNew: () => void }) {
  const { toast } = useToast();
  const share = async () => {
    const text = receiptText(sale, settings?.storeName);
    try {
      if (typeof navigator !== 'undefined' && 'share' in navigator && typeof navigator.share === 'function') {
        await navigator.share({ title: `Receipt ${sale.number}`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast({ kind: 'success', title: 'Receipt copied', body: 'Paste it into a message to the customer.' });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      toast({ kind: 'error', title: "Couldn't share", body: (e as Error).message });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-4 py-6 md:py-10">
        <span className="flex size-16 items-center justify-center rounded-full bg-ok-soft text-ok-ink"><Check className="size-8" strokeWidth={2.5} aria-hidden /></span>
        <div className="text-center">
          <h1 className="text-[22px] font-semibold">Sale complete</h1>
          <p className="tabular mt-1 text-sm text-ink-2">{sale.number} · {PAYMENT_LABEL[sale.paymentMethod]} · {formatTime(sale.createdAt)}</p>
        </div>
        <p className="tabular text-4xl font-semibold tracking-[-0.02em]">EGP {formatMoney(sale.total)}</p>
        <Receipt sale={sale} settings={settings} />
        <div className="grid w-full max-w-[320px] grid-cols-2 gap-2.5 no-print">
          <Button size="lg" leading={<Share2 />} onClick={() => void share()}>Share receipt</Button>
          <Button size="lg" leading={<Printer />} onClick={() => void printOrShare(`receipt-${sale.number}`)}>Print</Button>
        </div>
      </div>
      <footer className="no-print border-t border-line bg-surface px-4 py-3 safe-bottom md:px-6">
        <Button variant="primary" size="xl" block onClick={onNew} className="mx-auto max-w-[480px]">New sale</Button>
      </footer>
    </div>
  );
}
