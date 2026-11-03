'use client';
/**
 * Helpers shared by the product screens: status badges, stock summaries, the brand/category
 * catalog hook and the sort menu options. No API calls other than GET /brands, GET /categories,
 * GET /settings (for size / colour filter options).
 */
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatDateTime, formatMoney, formatPct, marginPct } from '@/lib/format';
import { Badge, ColorSwatch, StockBadge, Thumb } from '@/components/ui/Badge';
import { LinkButton } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/States';
import { ErrorState } from '@/components/ui/States';
import { VariantMatrix } from '@/components/app/VariantMatrix';
import type { ApiError } from '@/lib/api';
import type { ColorRef, ProductDetail, ProductListItem, ProductStatus, StockStatus } from '@/types';

/* ---------- status / stock ---------- */
export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return status === 'ARCHIVED' ? <Badge tone="neutral" dot>Archived</Badge> : <Badge tone="ok" dot>Active</Badge>;
}

/** Aggregate stock status of a product row: out when nothing is left, low when any variant is low or out. */
export function productStock(p: Pick<ProductListItem, 'totalQty' | 'lowCount' | 'outCount'>): StockStatus {
  if (p.totalQty <= 0) return 'out';
  if (p.lowCount > 0 || p.outCount > 0) return 'low';
  return 'ok';
}

/** Badge text like the artboards: "86 in stock", "54 · 3 low", "Out of stock". */
export function ProductStockBadge({ p }: { p: Pick<ProductListItem, 'totalQty' | 'lowCount' | 'outCount'> }) {
  const st = productStock(p);
  if (st === 'out') return <Badge tone="danger" dot>Out of stock</Badge>;
  const flagged = p.lowCount + p.outCount;
  if (st === 'low') return <Badge tone="warn" dot>{p.totalQty} · {flagged} low</Badge>;
  return <Badge tone="ok" dot>{p.totalQty} in stock</Badge>;
}

export { StockBadge };

/* ---------- sort ---------- */
export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: '-updated', label: 'Updated ↓' },
  { value: 'updated', label: 'Updated ↑' },
  { value: 'name', label: 'Name A–Z' },
  { value: '-name', label: 'Name Z–A' },
  { value: '-price', label: 'Price high–low' },
  { value: 'price', label: 'Price low–high' },
  { value: '-qty', label: 'Quantity high–low' },
  { value: 'qty', label: 'Quantity low–high' },
];
export const sortLabel = (value: string) => SORT_OPTIONS.find((o) => o.value === value)?.label ?? 'Updated ↓';

export const STOCK_FILTER_LABEL: Record<'in' | 'low' | 'out', string> = { in: 'In stock', low: 'Low', out: 'Out' };
export const STATUS_FILTER_LABEL: Record<'ACTIVE' | 'ARCHIVED' | 'ALL', string> = { ACTIVE: 'Active', ARCHIVED: 'Archived', ALL: 'All' };

/* ---------- catalog lists for filters and forms ---------- */
export function useCatalog() {
  const brands = useApi(() => api.catalog.brands(), []);
  const categories = useApi(() => api.catalog.categories(), []);
  const settings = useApi(() => api.settings.get(), []);
  const sizes = [...new Set((settings.data?.sizePresets ?? []).flatMap((p) => p.sizes))];
  const colors: ColorRef[] = settings.data?.colorPresets ?? [];
  return { brands: brands.data ?? [], categories: categories.data ?? [], sizes, colors, settings: settings.data, loading: brands.loading || categories.loading };
}

/* ---------- product summary (quick view drawer + tablet detail pane + seller card) ---------- */
export function ProductSummary({ product, loading, error, onRetry, isManager, compact, canEdit, canReceive }: {
  product: ProductDetail | undefined; loading: boolean; error?: ApiError; onRetry?: () => void; isManager: boolean; compact?: boolean; canEdit: boolean; canReceive: boolean;
}) {
  if (error && !product) return <ErrorState error={error} onRetry={onRetry} compact />;
  if (!product) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="flex gap-3"><Skeleton className="size-16 rounded-[10px]" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-5 w-1/4" /></div></div>
        <Skeleton className="h-32 rounded-card" />
      </div>
    );
  }
  const p = product;
  const margin = p.marginPct ?? marginPct(p.defaultPrice, p.defaultCost);
  const threshold = p.variants[0]?.lowStockThreshold;
  return (
    <div className="flex flex-col gap-5" aria-busy={loading || undefined}>
      <div className="flex gap-3.5">
        <Thumb src={p.coverImage} tint={p.tint} size="lg" alt="" />
        <div className="min-w-0 flex-1">
          <ProductStatusBadge status={p.status} />
          <p className="mt-1 text-sm text-ink-2">{p.brand.name} · {p.category.name} · <span className="tabular font-medium text-ink">{p.baseSku}</span></p>
          <p className="tabular mt-1 text-lg font-semibold">{formatMoney(p.defaultPrice, 'EGP', { withCurrency: true })}</p>
          {isManager && p.defaultCost !== undefined && <p className="tabular text-xs text-ink-2">Cost {formatMoney(p.defaultCost)}{margin !== undefined && ` · margin ${formatPct(margin)}`}</p>}
        </div>
      </div>
      <section>
        <p className="eyebrow mb-2">Stock by variant</p>
        {p.variants.length === 0 ? <p className="text-sm text-ink-2">No variants yet.</p> : <VariantMatrix sizes={p.sizes} colors={p.colors} variants={p.variants} cellHeight="sm" minCol={compact ? 48 : 56} />}
        {threshold !== undefined && !compact && <p className="mt-2 text-xs text-ink-2">Tap a cell on the product page to edit qty, cost, price, SKU, barcode and threshold. Threshold for this product: {threshold}.</p>}
      </section>
      <div className="flex flex-wrap gap-2">
        <LinkButton variant="primary" href={`/products/${p.id}`}>Open product</LinkButton>
        {canEdit && <LinkButton href={`/products/${p.id}/edit`}>Edit</LinkButton>}
        {canReceive && <LinkButton href={`/stock/receive?productId=${p.id}`}>Receive</LinkButton>}
      </div>
      <p className="text-xs text-ink-2">Updated {formatDateTime(p.updatedAt)} · Created {formatDateTime(p.createdAt)}</p>
    </div>
  );
}

/** Row used by the tablet list pane and mobile cards. */
export function ProductRowLink({ p, href, selected, onClick, trailing }: { p: ProductListItem; href?: string; selected?: boolean; onClick?: () => void; trailing?: React.ReactNode }) {
  const inner = (
    <>
      <Thumb src={p.coverImage} tint={p.tint} size="md" alt="" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{p.name}</span>
        <span className="block truncate text-xs text-ink-2">{p.brand.name} · {p.variantCount} variant{p.variantCount === 1 ? '' : 's'} · <span className="tabular">{p.totalQty}</span>{productStock(p) === 'ok' ? ' in stock' : ''}</span>
      </span>
      {trailing ?? (productStock(p) === 'ok' ? <span className="tabular text-sm font-semibold">{formatMoney(p.defaultPrice)}</span> : <ProductStockBadge p={p} />)}
    </>
  );
  const cls = `flex min-h-14 w-full items-center gap-3 border-b border-line px-3 text-left last:border-0 hover:bg-surface-2 ${selected ? 'bg-accent-soft/60' : ''}`;
  if (href) return <Link href={href} aria-current={selected ? 'true' : undefined} className={cls}>{inner}</Link>;
  return <button type="button" onClick={onClick} aria-current={selected ? 'true' : undefined} className={cls}>{inner}</button>;
}

export function ColorDot({ c }: { c: ColorRef }) { return <ColorSwatch hex={c.hex} name={c.name} />; }
