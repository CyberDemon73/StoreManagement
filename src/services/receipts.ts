import type { Db } from '@/db/client';
import type { AuthUser } from '@/lib/auth';
import { formatMoney } from '@/lib/format';
import type { SaleOut } from '@/serializers/sales';
import { getSale } from './sales';
import { getSettings } from './settings';

export interface ReceiptStore {
  storeName: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  currency: string;
  receiptHeader: string | null;
  receiptFooter: string | null;
}

export interface ReceiptData {
  sale: SaleOut;
  store: ReceiptStore;
}

/** Sale (ownership rules of getSale) plus the store block from settings. Null when not visible. */
export async function receiptJson(db: Db, user: AuthUser, id: string): Promise<ReceiptData | null> {
  const sale = await getSale(db, user, id);
  if (!sale) return null;
  const s = await getSettings(db);
  return {
    sale,
    store: {
      storeName: s.storeName,
      phone: s.phone,
      address: s.address,
      logoUrl: s.logoUrl,
      currency: s.currency,
      receiptHeader: s.receiptHeader,
      receiptFooter: s.receiptFooter,
    },
  };
}

/** Escape for text nodes and double-quoted attribute values. Every dynamic string goes through here. */
export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Only http(s) logos are embedded; anything else (javascript:, data:) is dropped.
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Self-contained printable receipt: inline CSS, no scripts, everything escaped. */
export function receiptHtml({ sale, store }: ReceiptData): string {
  const money = (minor: number) => escapeHtml(formatMoney(minor, store.currency, { withCurrency: true }));
  const logo = safeUrl(store.logoUrl);
  const lines = sale.items
    .map(
      (i) => `<tr>
  <td>${escapeHtml(i.productName)}<div class="muted">${escapeHtml(i.size)} / ${escapeHtml(i.color.name)}</div></td>
  <td class="num">${escapeHtml(i.qty)} &times; ${money(i.unitPrice)}</td>
  <td class="num">${money(i.lineTotal)}</td>
</tr>`,
    )
    .join('\n');
  const discountRow = sale.discount > 0 ? `<tr><td colspan="2">Discount${sale.discountPct !== undefined ? ` (${escapeHtml(sale.discountPct)} %)` : ''}</td><td class="num">&minus;${money(sale.discount)}</td></tr>` : '';
  const header = [
    logo ? `<img class="logo" src="${escapeHtml(logo)}" alt="">` : '',
    `<h1>${escapeHtml(store.storeName)}</h1>`,
    store.address ? `<div class="muted">${escapeHtml(store.address)}</div>` : '',
    store.phone ? `<div class="muted">${escapeHtml(store.phone)}</div>` : '',
    store.receiptHeader ? `<p class="note">${escapeHtml(store.receiptHeader)}</p>` : '',
  ].join('\n');
  const customer = sale.customerName ? `<div>Customer: ${escapeHtml(sale.customerName)}</div>` : '';
  const voidBanner = sale.status === 'VOID' ? `<div class="void">VOID</div>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${escapeHtml(sale.number)}</title>
<style>
  body { font: 13px/1.4 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 16px; background: #fff; }
  .receipt { max-width: 360px; margin: 0 auto; }
  header { text-align: center; margin-bottom: 12px; }
  h1 { font-size: 18px; margin: 4px 0; }
  .logo { max-height: 64px; max-width: 160px; }
  .muted { color: #666; font-size: 12px; }
  .note { white-space: pre-wrap; }
  .meta { border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 8px 0; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 0; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .totals { border-top: 1px dashed #999; margin-top: 8px; padding-top: 8px; }
  .totals .grand td { font-weight: 700; font-size: 15px; }
  .void { color: #b00020; font-weight: 700; font-size: 20px; text-align: center; letter-spacing: 4px; }
  footer { text-align: center; margin-top: 16px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<div class="receipt">
<header>
${header}
</header>
${voidBanner}
<div class="meta">
  <div>Receipt <strong>${escapeHtml(sale.number)}</strong></div>
  <div>Date: ${escapeHtml(sale.createdAt)}</div>
  <div>Served by: ${escapeHtml(sale.sellerName)}</div>
  ${customer}
</div>
<table>
<tbody>
${lines}
</tbody>
</table>
<table class="totals">
<tbody>
<tr><td colspan="2">Subtotal</td><td class="num">${money(sale.subtotal)}</td></tr>
${discountRow}
<tr class="grand"><td colspan="2">Total</td><td class="num">${money(sale.total)}</td></tr>
<tr><td colspan="2">Paid by</td><td class="num">${escapeHtml(sale.paymentMethod)}</td></tr>
</tbody>
</table>
<footer>
${store.receiptFooter ? `<p class="note">${escapeHtml(store.receiptFooter)}</p>` : ''}
</footer>
</div>
</body>
</html>
`;
}
