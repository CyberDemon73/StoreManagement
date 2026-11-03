'use client';
/**
 * Secondary tabs of /products/[id]: Movements (GET /stock/movements?productId), Sales
 * (GET /sales?productId), Details, plus the "+ Add size / + Add color" dialog
 * (POST /products/:id/variants).
 */
import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime, formatMoney, MOVEMENT_LABEL, PAYMENT_LABEL } from '@/lib/format';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge, ColorSwatch, SaleStatusBadge, type Tone } from '@/components/ui/Badge';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Overlay';
import { Field, Input } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import type { MovementType, ProductDetail, Sale, StockMovement } from '@/types';

const MOVEMENT_TONE: Record<MovementType, Tone> = { INITIAL: 'neutral', PURCHASE: 'info', SALE: 'ok', RETURN: 'warn', ADJUSTMENT: 'accent' };

/* ---------- Movements ---------- */
export function MovementsTab({ productId }: { productId: string }) {
  const auth = useAuth();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const list = useApi(() => api.stock.movements({ productId, page, pageSize }), [productId, page, pageSize]);
  const columns: Column<StockMovement>[] = [
    { key: 'date', header: 'Date', cell: (m) => <span className="tabular whitespace-nowrap text-ink-2">{formatDateTime(m.createdAt)}</span> },
    { key: 'variant', header: 'Variant', cell: (m) => <span className="flex items-center gap-2"><ColorSwatch hex={m.variant.color.hex} name={m.variant.color.name} />{m.variant.size} · {m.variant.color.name}</span> },
    { key: 'type', header: 'Type', cell: (m) => <Badge tone={MOVEMENT_TONE[m.type]}>{MOVEMENT_LABEL[m.type]}</Badge> },
    { key: 'delta', header: 'Δ qty', align: 'right', cell: (m) => <span className={m.qtyDelta < 0 ? 'text-danger-ink' : 'text-ok-ink'}>{m.qtyDelta > 0 ? '+' : m.qtyDelta < 0 ? '−' : ''}{Math.abs(m.qtyDelta)}</span> },
    { key: 'after', header: 'After', align: 'right', cell: (m) => m.qtyAfter },
    { key: 'cost', header: 'Unit cost', align: 'right', when: auth.isManager, cell: (m) => m.unitCost !== undefined ? formatMoney(m.unitCost) : '—' },
    { key: 'ref', header: 'Reference', cell: (m) => m.reference ? <Link href={m.reference.kind === 'sale' ? `/sales?open=${m.reference.id}` : m.reference.kind === 'purchase' ? '/stock/receive' : m.reference.kind === 'count' ? `/stock/count/${m.reference.id}` : '/sales'} className="text-accent hover:underline">{m.reference.label}</Link> : <span className="text-ink-2">{m.reason ?? '—'}</span> },
    { key: 'by', header: 'By', cell: (m) => m.userName.split(' ')[0] },
  ];
  return <DataTable aria-label="Stock movements" columns={columns} rows={list.data?.data} rowKey={(m) => m.id} loading={list.loading} error={list.error} onRetry={() => void list.refetch()} compact
    page={{ page, pageSize, total: list.data?.total ?? 0, onPage: setPage, onPageSize: (n) => { setPageSize(n); setPage(1); } }}
    empty={<EmptyState compact title="No movements yet" body="Receiving stock, sales, returns and adjustments for this product will show here." />} />;
}

/* ---------- Sales ---------- */
export function SalesTab({ product }: { product: ProductDetail }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const list = useApi(() => api.sales.list({ productId: product.id, page, pageSize }), [product.id, page, pageSize]);
  const variantIds = new Set(product.variants.map((v) => v.id));
  const columns: Column<Sale>[] = [
    { key: 'number', header: 'Sale', cell: (s) => <Link href={`/sales?open=${s.id}`} className="tabular font-medium text-accent hover:underline">{s.number}</Link> },
    { key: 'date', header: 'Date', cell: (s) => <span className="tabular whitespace-nowrap text-ink-2">{formatDateTime(s.createdAt)}</span> },
    { key: 'seller', header: 'Seller', cell: (s) => s.sellerName },
    { key: 'items', header: 'This product', cell: (s) => { const mine = s.items.filter((i) => variantIds.has(i.variantId)); return <span className="text-ink-2">{mine.map((i) => `${i.size} · ${i.color.name} ×${i.qty}`).join(', ') || '—'}</span>; } },
    { key: 'payment', header: 'Payment', cell: (s) => PAYMENT_LABEL[s.paymentMethod] },
    { key: 'total', header: 'Total', align: 'right', cell: (s) => <span className="font-medium">{formatMoney(s.total)}</span> },
    { key: 'status', header: 'Status', cell: (s) => <SaleStatusBadge status={s.status} /> },
  ];
  return <DataTable aria-label="Sales of this product" columns={columns} rows={list.data?.data} rowKey={(s) => s.id} loading={list.loading} error={list.error} onRetry={() => void list.refetch()} compact
    page={{ page, pageSize, total: list.data?.total ?? 0, onPage: setPage, onPageSize: (n) => { setPageSize(n); setPage(1); } }}
    empty={<EmptyState compact title="No sales yet" body="Sales that include this product will show here." />} />;
}

/* ---------- Details ---------- */
export function DetailsTab({ product }: { product: ProductDetail }) {
  const p = product;
  return (
    <div className="grid gap-5 rounded-card border border-line bg-surface p-4 md:grid-cols-2 md:p-5">
      <section className="flex flex-col gap-2 md:col-span-2">
        <h3 className="eyebrow">Description</h3>
        {p.description ? <p className="max-w-prose text-sm leading-relaxed">{p.description}</p> : <p className="text-sm text-ink-2">No description.</p>}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">Tags</h3>
        {p.tags.length ? <div className="flex flex-wrap gap-1.5">{p.tags.map((t) => <Chip key={t} size="sm">{t}</Chip>)}</div> : <p className="text-sm text-ink-2">No tags.</p>}
      </section>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="eyebrow">Base SKU</dt><dd className="tabular font-medium">{p.baseSku}</dd></div>
        <div><dt className="eyebrow">Variants</dt><dd className="tabular font-medium">{p.variantCount} · {p.sizes.length} sizes × {p.colors.length} colors</dd></div>
        <div><dt className="eyebrow">Created</dt><dd className="tabular">{formatDateTime(p.createdAt)}{p.createdBy ? <span className="text-ink-2"> · by {p.createdBy}</span> : null}</dd></div>
        <div><dt className="eyebrow">Updated</dt><dd className="tabular">{formatDateTime(p.updatedAt)}</dd></div>
        <div><dt className="eyebrow">Brand</dt><dd>{p.brand.name}</dd></div>
        <div><dt className="eyebrow">Category</dt><dd>{p.category.name}</dd></div>
      </dl>
    </div>
  );
}

/* ---------- Add size / color dialog ---------- */
export function AddVariantsDialog({ product, kind, open, onClose, onAdded }: { product: ProductDetail; kind: 'size' | 'color'; open: boolean; onClose: () => void; onAdded: () => Promise<void> | void }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [hex, setHex] = useState('#8A5B3C');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const trimmed = name.trim();
  const dup = kind === 'size' ? product.sizes.includes(trimmed) : product.colors.some((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  const other = kind === 'size' ? product.colors.length : product.sizes.length;
  const submit = async () => {
    if (!trimmed) { setError(`Enter a ${kind} name`); return; }
    if (dup) { setError(`${trimmed} already exists on this product`); return; }
    if (kind === 'color' && !/^#[0-9a-fA-F]{6}$/.test(hex)) { setError('Hex must look like #8A5B3C'); return; }
    setPending(true);
    try {
      const input = kind === 'size' ? { sizes: [trimmed], colors: product.colors } : { sizes: product.sizes, colors: [{ name: trimmed, hex }] };
      const made = await api.products.addVariants(product.id, input);
      await onAdded();
      toast({ kind: 'success', title: `Added ${kind} ${trimmed}`, body: `${made.length} new variant${made.length === 1 ? '' : 's'} at quantity 0.` });
      setName(''); onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally { setPending(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={kind === 'size' ? 'Add a size' : 'Add a color'} description={`Creates ${other} new variant${other === 1 ? '' : 's'} (one per existing ${kind === 'size' ? 'color' : 'size'}) with quantity 0. Receive stock afterwards.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={pending} onClick={() => void submit()}>Add {kind}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={kind === 'size' ? 'Size' : 'Color name'} htmlFor="av-name" error={error}><Input id="av-name" value={name} onChange={(e) => { setName(e.target.value); setError(undefined); }} placeholder={kind === 'size' ? 'e.g. XXL' : 'e.g. Olive'} invalid={!!error} data-autofocus onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} /></Field>
        {kind === 'color' && <Field label="Hex" htmlFor="av-hex"><Input id="av-hex" value={hex} onChange={(e) => setHex(e.target.value)} className="tabular" leading={<ColorSwatch hex={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#FFFFFF'} />} /></Field>}
      </div>
    </Dialog>
  );
}
