'use client';
/**
 * Cart lines + totals + payment + Charge. Rendered in the right aside on tablet/desktop and
 * inside a bottom Sheet on mobile. Totals come from api.sales.preview (same rules as POST /sales).
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ShoppingBag, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Thumb, ColorSwatch } from '@/components/ui/Badge';
import { Input, Segmented } from '@/components/ui/Field';
import { QuantityInput } from '@/components/ui/Controls';
import type { Cart, CartLine, PaymentMethod, Settings } from '@/types';
import type { CartActions } from './useCart';

export interface CartPreview { subtotal: number; discount: number; total: number; capHit: boolean; cap: number; count: number }

export interface CartPanelProps {
  cart: Cart;
  actions: CartActions;
  preview: CartPreview;
  isSeller: boolean;
  settings?: Settings;
  /** variantId → message, from an INSUFFICIENT_STOCK error. */
  stockErrors: Record<string, string>;
  onCharge: () => void;
  charging: boolean;
  /** Desktop/tablet aside shows its own header; the mobile Sheet provides one. */
  showHeader?: boolean;
  className?: string;
}

const PAYMENTS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' }, { value: 'CARD', label: 'Card' }, { value: 'WALLET', label: 'Wallet' }, { value: 'TRANSFER', label: 'Transfer' },
];

/** True when the cart cannot be charged yet; returns the reason for the UI. */
export function chargeBlocker(cart: Cart, settings: Settings | undefined): string | undefined {
  if (cart.lines.length === 0) return 'Cart is empty';
  if (cart.paymentMethod === 'TRANSFER' && settings?.requirePhoneOnTransfer && !(cart.customerPhone ?? '').trim()) return 'Customer phone is required for transfers';
  return undefined;
}

export function CartPanel({ cart, actions, preview, isSeller, settings, stockErrors, onCharge, charging, showHeader = true, className }: CartPanelProps) {
  const phoneRequired = cart.paymentMethod === 'TRANSFER' && !!settings?.requirePhoneOnTransfer;
  const phoneMissing = phoneRequired && !(cart.customerPhone ?? '').trim();
  const [customerOpen, setCustomerOpen] = useState(!!(cart.customerName || cart.customerPhone || cart.note));
  useEffect(() => { if (phoneRequired) setCustomerOpen(true); }, [phoneRequired]);
  const blocker = chargeBlocker(cart, settings);
  const empty = cart.lines.length === 0;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {showHeader && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 md:px-5">
          <h2 className="text-base font-semibold">Cart</h2>
          <span className="tabular rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-2" aria-live="polite">{preview.count} item{preview.count === 1 ? '' : 's'}</span>
          <Button variant="ghost" size="sm" className="ml-auto" disabled={empty} onClick={actions.clear}>Clear</Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 md:px-5">
        {empty ? (
          <div className="my-auto flex flex-col items-center gap-2 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-2"><ShoppingBag className="size-5" aria-hidden /></span>
            <p className="font-semibold">Cart is empty</p>
            <p className="text-sm text-ink-2">Pick a size and color, then add. Or scan a barcode.</p>
          </div>
        ) : (
          <ul>
            {cart.lines.map((l) => <CartLineRow key={l.variantId} line={l} actions={actions} error={stockErrors[l.variantId]} />)}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2.5 border-t border-line bg-bg px-4 py-3 md:px-5">
        <div className="flex items-center text-sm" aria-live="polite" aria-atomic="true">
          <span className="text-ink-2">Subtotal</span>
          <span className="tabular ml-auto">{formatMoney(preview.subtotal)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
          <label htmlFor="pos-discount" className="text-ink-2">Discount</label>
          <Segmented size="sm" aria-label="Discount type" value={cart.discount.type} onChange={(t) => actions.setDiscount({ type: t, value: cart.discount.value })} options={[{ value: 'PCT', label: '%' }, { value: 'AMOUNT', label: 'EGP' }]} />
          <Input id="pos-discount" size="sm" align="right" inputMode="decimal" wrapperClassName="w-[72px] min-w-0 shrink" aria-label="Discount value" value={cart.discount.value === 0 ? '' : String(cart.discount.value)} placeholder="0"
            onChange={(e) => { const n = parseFloat(e.target.value.replace(/[^0-9.]/g, '')); actions.setDiscount({ type: cart.discount.type, value: Number.isFinite(n) ? n : 0 }); }} />
          <span className="tabular ml-auto whitespace-nowrap text-danger-ink">−{formatMoney(preview.discount)}</span>
        </div>
        {preview.capHit && isSeller && <p role="alert" className="text-xs text-warn-ink">Sellers can discount up to {preview.cap}%. Ask a manager for more.</p>}

        <Segmented size="lg" grow aria-label="Payment method" value={cart.paymentMethod} onChange={actions.setPayment} options={PAYMENTS} />

        <div>
          <button type="button" aria-expanded={customerOpen} onClick={() => setCustomerOpen((o) => !o)} className="flex min-h-9 w-full items-center gap-1.5 text-left text-sm text-ink-2 hover:text-ink">
            Customer &amp; note {phoneRequired ? <span className="text-warn-ink">(phone required)</span> : '(optional)'}
            {customerOpen ? <ChevronUp className="ml-auto size-4" aria-hidden /> : <ChevronDown className="ml-auto size-4" aria-hidden />}
          </button>
          {customerOpen && (
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <Input aria-label="Customer name" placeholder="Customer name" autoComplete="off" value={cart.customerName ?? ''} onChange={(e) => actions.setCustomer({ name: e.target.value })} />
              <Input aria-label="Customer phone" placeholder={phoneRequired ? 'Phone (required)' : 'Phone'} type="tel" inputMode="tel" autoComplete="off" invalid={phoneMissing} value={cart.customerPhone ?? ''} onChange={(e) => actions.setCustomer({ phone: e.target.value })} />
              <Input aria-label="Note" placeholder="Note" wrapperClassName="col-span-2" value={cart.note ?? ''} onChange={(e) => actions.setNote(e.target.value)} />
              {phoneMissing && <p role="alert" className="col-span-2 text-xs text-danger-ink">A phone number is required for bank transfers.</p>}
            </div>
          )}
        </div>

        <Button variant="primary" size="xl" block loading={charging} disabled={!!blocker} onClick={onCharge} aria-describedby={blocker ? 'pos-charge-hint' : undefined} className="justify-between">
          <span>Charge</span>
          <span className="tabular" aria-live="polite" aria-atomic="true">EGP {formatMoney(preview.total)}</span>
        </Button>
        {blocker && !empty && <p id="pos-charge-hint" className="text-center text-xs text-ink-2">{blocker}</p>}
      </div>
    </div>
  );
}

function CartLineRow({ line, actions, error }: { line: CartLine; actions: CartActions; error?: string }) {
  return (
    <li className={cn('flex items-start gap-2.5 border-b border-line py-3 last:border-0', error && '-mx-2 rounded-lg bg-danger-soft/40 px-2')}>
      <Thumb tint={line.tint} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{line.productName}</p>
        <p className="flex items-center gap-1 text-xs text-ink-2">{line.size} · <ColorSwatch hex={line.color.hex} name={line.color.name} size="xs" />{line.color.name} · <span className="tabular">{formatMoney(line.unitPrice)}</span> each</p>
        <div className="mt-1.5 flex items-center gap-2">
          <QuantityInput size="sm" value={line.qty} min={0} max={Math.max(1, line.available)} onChange={(q) => actions.setQty(line.variantId, q)} aria-label={`Quantity of ${line.productName} ${line.size} ${line.color.name}`} />
          {line.qty >= line.available && !error && <span className="text-xs text-ink-2">max {line.available}</span>}
        </div>
        {error && <p role="alert" className="mt-1 text-xs text-danger-ink">{error}</p>}
      </div>
      <div className="flex flex-col items-end gap-1">
        <p className="tabular text-sm font-semibold">{formatMoney(line.unitPrice * line.qty)}</p>
        <Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${line.productName}`} onClick={() => actions.remove(line.variantId)}><Trash2 /></Button>
      </div>
    </li>
  );
}
