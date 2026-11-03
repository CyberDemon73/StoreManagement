'use client';
/**
 * Non-table renderings of the product list: mobile cards (manager + seller variants) and the
 * tablet list/detail split. Data arrives from ProductsListScreen; the seller card and tablet pane
 * fetch GET /products/:id for the matrix.
 */
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Package } from 'lucide-react';
import { api, type ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Thumb } from '@/components/ui/Badge';
import { Button, LinkButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/States';
import { VariantMatrix } from '@/components/app/VariantMatrix';
import type { ProductListItem } from '@/types';
import { ProductRowLink, ProductStatusBadge, ProductStockBadge, ProductSummary } from './products-shared';

interface ListState { rows: ProductListItem[] | undefined; loading: boolean; initial: boolean; error?: ApiError; refetch: () => void; total: number }

/* ---------- mobile cards ---------- */
export function MobileCards({ list, seller, emptyBody, onClearFilters, onLoadMore, hasFilters }: { list: ListState; seller: boolean; emptyBody: string; onClearFilters: () => void; onLoadMore?: () => void; hasFilters: boolean }) {
  if (list.initial) return <div className="rounded-card border border-line bg-surface px-3"><SkeletonRows rows={6} /></div>;
  if (list.error && !list.rows) return <ErrorState error={list.error} onRetry={list.refetch} />;
  const rows = list.rows ?? [];
  if (rows.length === 0) return <EmptyState icon={<Package aria-hidden />} title="No products" body={emptyBody} action={hasFilters ? <Button onClick={onClearFilters}>Clear filters</Button> : undefined} />;
  return (
    <div className="flex flex-col gap-2" aria-busy={list.loading || undefined}>
      {rows.map((p) => seller ? <SellerCard key={p.id} p={p} /> : <ManagerCard key={p.id} p={p} />)}
      <p className="py-2 text-center text-xs text-ink-2">Showing {rows.length} of {list.total}{onLoadMore && rows.length < list.total && <> · <button type="button" className="font-medium text-accent" onClick={onLoadMore}>Load more</button></>}</p>
    </div>
  );
}

function CardBody({ p, right }: { p: ProductListItem; right?: ReactNode }) {
  return (
    <>
      <Thumb src={p.coverImage} tint={p.tint} size="lg" alt="" className="size-14" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">{p.name}</p>
        <p className="truncate text-xs text-ink-2">{p.brand.name} · {p.variantCount} variant{p.variantCount === 1 ? '' : 's'}</p>
        <div className="mt-1.5 flex items-center gap-2"><span className="tabular text-sm font-semibold">{formatMoney(p.defaultPrice)}</span>{p.status === 'ARCHIVED' ? <ProductStatusBadge status={p.status} /> : <ProductStockBadge p={p} />}</div>
      </div>
      {right}
    </>
  );
}

function ManagerCard({ p }: { p: ProductListItem }) {
  return (
    <Link href={`/products/${p.id}`} className="flex min-h-[72px] items-center gap-3 rounded-card border border-line bg-surface p-3 active:bg-surface-2">
      <CardBody p={p} right={<ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />} />
    </Link>
  );
}

/** Seller card: tap to expand a read-only mini matrix and a "Sell this" link (Seller-Products artboard). */
function SellerCard({ p }: { p: ProductListItem }) {
  const [open, setOpen] = useState(false);
  const detail = useApi(() => api.products.get(p.id), [p.id], { enabled: open });
  return (
    <article className="rounded-card border border-line bg-surface">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-[72px] w-full items-center gap-3 p-3 text-left">
        <CardBody p={p} right={<ChevronDown className={cn('size-5 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} aria-hidden />} />
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-3 pb-3 pt-3">
          <p className="truncate text-xs text-ink-2">{p.brand.name} · <span className="tabular">{p.baseSku}</span></p>
          {detail.error && !detail.data ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} compact /> : !detail.data ? <Skeleton className="h-28 rounded-lg" /> : detail.data.variants.length === 0 ? <p className="text-sm text-ink-2">No variants yet.</p> : <VariantMatrix sizes={detail.data.sizes} colors={detail.data.colors} variants={detail.data.variants} cellHeight="sm" minCol={48} />}
          <div className="flex gap-2">
            <LinkButton variant="primary" size="lg" className="flex-1" href={`/sell?productId=${p.id}`}>Sell this</LinkButton>
            <LinkButton size="lg" href={`/products/${p.id}`}>Details</LinkButton>
          </div>
        </div>
      )}
    </article>
  );
}

/* ---------- tablet: list + detail split ---------- */
export function TabletSplit({ list, selectedId, onSelect, emptyBody, onClearFilters, hasFilters, isManager, canEdit, canReceive, pager }: {
  list: ListState; selectedId: string | undefined; onSelect: (id: string) => void; emptyBody: string; onClearFilters: () => void; hasFilters: boolean; isManager: boolean; canEdit: boolean; canReceive: boolean; pager: ReactNode;
}) {
  const detail = useApi(() => api.products.get(selectedId ?? ''), [selectedId], { enabled: !!selectedId });
  const rows = list.rows ?? [];
  const current = rows.find((r) => r.id === selectedId);
  return (
    <div className="grid min-h-[60vh] grid-cols-[minmax(300px,2fr)_3fr] gap-4">
      <section aria-label="Product list" className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
        <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={list.loading || undefined}>
          {list.initial ? <div className="px-3"><SkeletonRows rows={8} /></div> : list.error && !list.rows ? <ErrorState error={list.error} onRetry={list.refetch} compact /> : rows.length === 0 ? <EmptyState compact icon={<Package aria-hidden />} title="No products" body={emptyBody} action={hasFilters ? <Button size="sm" onClick={onClearFilters}>Clear filters</Button> : undefined} /> : rows.map((p) => <ProductRowLink key={p.id} p={p} selected={p.id === selectedId} onClick={() => onSelect(p.id)} />)}
        </div>
        <div className="border-t border-line px-3 py-2">{pager}</div>
      </section>
      <section aria-label="Selected product" className="rounded-card border border-line bg-surface p-4 md:p-5">
        {!selectedId ? <EmptyState compact title="Select a product" body="Pick a product on the left to see its stock by variant." /> : (
          <>
            <header className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{current?.name ?? detail.data?.name ?? '…'}</h2>
              {canEdit && <LinkButton size="sm" href={`/products/${selectedId}/edit`}>Edit</LinkButton>}
              {canReceive && <LinkButton size="sm" href={`/stock/receive?productId=${selectedId}`}>Receive</LinkButton>}
            </header>
            <ProductSummary product={detail.data} loading={detail.loading} error={detail.error} onRetry={() => void detail.refetch()} isManager={isManager} canEdit={canEdit} canReceive={canReceive} />
          </>
        )}
      </section>
    </div>
  );
}
