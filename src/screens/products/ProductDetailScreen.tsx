'use client';
/**
 * Screen: /products/[id] · Roles: ADMIN, MANAGER, SELLER (sellers: no cost/margin, read-only
 * variants, no adjust, no edit/archive/labels).
 * Calls: GET /products/:id · POST /products/:id/archive|unarchive · POST /products/:id/variants ·
 * PATCH /variants/:id · POST /stock/adjustments · GET /stock/movements?productId · GET /sales?productId.
 * Layout: gallery + KPIs, tabs (Variants / Movements / Sales / Details); tapping a matrix cell opens
 * the variant editor (Sheet on mobile, Drawer otherwise).
 */
import { useState } from 'react';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Printer, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useBreakpoint, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { formatMoney, formatNumber, formatPct, marginPct } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { MatrixLegend, VariantMatrix } from '@/components/app/VariantMatrix';
import { Button, LinkButton } from '@/components/ui/Button';
import { Chip, Thumb } from '@/components/ui/Badge';
import { Card, KpiCard } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Controls';
import { ConfirmDialog, MenuItem, Popover } from '@/components/ui/Overlay';
import { EmptyState, ErrorState, Skeleton, SkeletonKpis } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import type { ProductDetail } from '@/types';
import { ProductStatusBadge } from './products-shared';
import { VariantEditorPanel } from './VariantEditorPanel';
import { AddVariantsDialog, DetailsTab, MovementsTab, SalesTab } from './ProductDetailTabs';

type Tab = 'variants' | 'movements' | 'sales' | 'details';

export function ProductDetailScreen({ id }: { id: string }) {
  const auth = useAuth();
  const bp = useBreakpoint();
  const { toast } = useToast();
  const product = useApi(() => api.products.get(id), [id]);
  const p = product.data;
  const [tab, setTab] = useState<Tab>('variants');
  const [variantId, setVariantId] = useState<string>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [addKind, setAddKind] = useState<'size' | 'color'>();
  const [moreOpen, setMoreOpen] = useState(false);
  const archive = useMutation((on: boolean) => api.products.archive(id, on));

  const canWrite = auth.can('products.write');
  const canReceive = auth.can('stock.receive');
  const canLedger = auth.can('stock.read.ledger');
  const isManager = auth.isManager;

  const toggleArchive = async () => {
    if (!p) return;
    const on = p.status === 'ACTIVE';
    try {
      const next = await archive.mutate(on);
      if (next) product.setData(next);
      toast({ kind: 'success', title: on ? 'Product archived' : 'Product restored', body: on ? 'It no longer appears in the POS or the default list.' : 'It is back in the catalog.' });
    } catch (e) { toast({ kind: 'error', title: on ? "Couldn't archive" : "Couldn't restore", body: (e as Error).message }); }
    setArchiveOpen(false);
  };

  if (product.error && !p) {
    return (
      <>
        <PageHeader title="Product" back="/products" crumbs={[{ label: 'Products', href: '/products' }]} />
        <Page>{product.error.code === 'NOT_FOUND' ? <EmptyState title="Product not found" body="It may have been deleted, or the link is wrong." action={<LinkButton href="/products">Back to products</LinkButton>} /> : <ErrorState error={product.error} onRetry={() => void product.refetch()} />}</Page>
      </>
    );
  }

  const selectedVariant = p?.variants.find((v) => v.id === variantId);
  const secondary = p && (
    <>
      {canWrite && <MenuItem href={`/labels?productId=${p.id}`}><Printer />Print labels</MenuItem>}
      {canWrite && <MenuItem onClick={() => { setMoreOpen(false); setArchiveOpen(true); }} danger={p.status === 'ACTIVE'}>{p.status === 'ACTIVE' ? <><Archive />Archive</> : <><ArchiveRestore />Restore</>}</MenuItem>}
    </>
  );

  return (
    <>
      <PageHeader title={p?.name ?? 'Product'} compactTitle={p?.name} back="/products" crumbs={[{ label: 'Products', href: '/products' }, { label: p?.category.name ?? '…', href: p ? `/products?categoryId=${p.categoryId}` : undefined }, { label: p?.name ?? '…' }]}
        actions={p && bp === 'desktop' ? (
          <>
            {canWrite && <LinkButton leading={<Printer />} href={`/labels?productId=${p.id}`}>Print labels</LinkButton>}
            {canWrite && <Button leading={p.status === 'ACTIVE' ? <Archive /> : <ArchiveRestore />} onClick={() => setArchiveOpen(true)}>{p.status === 'ACTIVE' ? 'Archive' : 'Restore'}</Button>}
            {canReceive && <LinkButton leading={<Truck />} href={`/stock/receive?productId=${p.id}`}>Receive stock</LinkButton>}
            {canWrite && <LinkButton variant="primary" leading={<Pencil />} href={`/products/${p.id}/edit`}>Edit</LinkButton>}
          </>
        ) : p && bp === 'tablet' ? (
          <>
            {canReceive && <LinkButton href={`/stock/receive?productId=${p.id}`}>Receive</LinkButton>}
            {canWrite && <LinkButton variant="primary" href={`/products/${p.id}/edit`}>Edit</LinkButton>}
            {canWrite && <Popover open={moreOpen} onClose={() => setMoreOpen(false)} anchor={<Button iconOnly aria-label="More actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}><MoreHorizontal /></Button>}>{secondary}</Popover>}
          </>
        ) : undefined} />
      <Page>
        {/* hero */}
        <section className="grid gap-4 md:grid-cols-[auto_1fr] md:gap-6">
          <Gallery p={p} />
          <div className="flex min-w-0 flex-col gap-3">
            {!p ? <><Skeleton className="h-7 w-2/3" /><Skeleton className="h-4 w-1/2" /></> : (
              <>
                <div className="flex flex-wrap items-center gap-2.5"><h2 className="truncate text-xl font-semibold md:text-2xl">{p.name}</h2><ProductStatusBadge status={p.status} /></div>
                <p className="text-sm text-ink-2">{p.brand.name} · {p.category.name} · Base SKU <span className="tabular font-medium text-ink">{p.baseSku}</span></p>
                {p.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{p.tags.map((t) => <Chip key={t} size="sm">{t}</Chip>)}</div>}
              </>
            )}
            <Kpis p={p} isManager={isManager} />
          </div>
        </section>

        <Tabs value={tab} onChange={setTab} scroll items={[{ value: 'variants', label: 'Variants', count: p?.variantCount }, { value: 'movements', label: 'Movements', disabled: !canLedger && !isManager }, { value: 'sales', label: 'Sales' }, { value: 'details', label: 'Details' }]} />

        {tab === 'variants' && (
          <Card as="section" aria-label="Variant matrix">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold">Sizes × colors</h3>
              <div className="flex flex-wrap items-center gap-3">
                <MatrixLegend threshold={p?.variants[0]?.lowStockThreshold} />
                {canWrite && p && <div className="flex gap-1.5"><Button size="sm" leading={<Plus />} onClick={() => setAddKind('size')}>Add size</Button><Button size="sm" leading={<Plus />} onClick={() => setAddKind('color')}>Add color</Button></div>}
              </div>
            </div>
            {!p ? <Skeleton className="h-48 rounded-lg" /> : p.variants.length === 0 ? <EmptyState compact title="No variants yet" body="Add a size and a color to create the first variants." action={canWrite ? <Button size="sm" onClick={() => setAddKind('size')}>Add size</Button> : undefined} /> : (
              <VariantMatrix sizes={p.sizes} colors={p.colors} variants={p.variants} selectedId={variantId} onSelect={(v) => setVariantId(v.id)} showTotals={bp !== 'mobile'} cellHeight={bp === 'mobile' ? 'lg' : 'md'} minCol={bp === 'mobile' ? 60 : 72} />
            )}
            <p className="mt-3 text-xs text-ink-2">{bp === 'mobile' ? 'Swipe to see more colors. Tap a cell to edit.' : canWrite ? 'Click a cell to edit that variant: price, SKU, barcode, threshold and quantity.' : 'Click a cell to see that variant.'}</p>
          </Card>
        )}
        {tab === 'movements' && <MovementsTab productId={id} />}
        {tab === 'sales' && (p ? <SalesTab product={p} /> : <Skeleton className="h-48 rounded-card" />)}
        {tab === 'details' && (p ? <DetailsTab product={p} /> : <Skeleton className="h-48 rounded-card" />)}

        {p && bp === 'mobile' && (canReceive || canWrite) && (
          <div className="flex gap-2">
            {canReceive && <LinkButton size="lg" className="flex-1" leading={<Truck />} href={`/stock/receive?productId=${p.id}`}>Receive</LinkButton>}
            {canWrite && <LinkButton size="lg" variant="primary" className="flex-1" leading={<Pencil />} href={`/products/${p.id}/edit`}>Edit</LinkButton>}
            {canWrite && <Popover open={moreOpen} onClose={() => setMoreOpen(false)} anchor={<Button size="lg" iconOnly aria-label="More actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}><MoreHorizontal /></Button>}>{secondary}</Popover>}
          </div>
        )}
      </Page>

      <VariantEditorPanel variant={selectedVariant} open={!!selectedVariant} onClose={() => setVariantId(undefined)} onSaved={() => product.refetch()} />
      {p && addKind && <AddVariantsDialog product={p} kind={addKind} open onClose={() => setAddKind(undefined)} onAdded={() => product.refetch()} />}
      {p && <ConfirmDialog open={archiveOpen} onClose={() => setArchiveOpen(false)} onConfirm={() => void toggleArchive()} pending={archive.pending} danger={p.status === 'ACTIVE'} confirmLabel={p.status === 'ACTIVE' ? 'Archive' : 'Restore'}
        title={p.status === 'ACTIVE' ? `Archive ${p.name}?` : `Restore ${p.name}?`} description={p.status === 'ACTIVE' ? 'Archived products disappear from the POS and the default list. Stock and history are kept.' : 'The product returns to the catalog and the POS.'} />}
    </>
  );
}

function Gallery({ p }: { p: ProductDetail | undefined }) {
  if (!p) return <div className="flex gap-2 md:flex-col"><Skeleton className="size-28 rounded-xl md:size-40" /><div className="flex gap-2 md:flex-row">{[0, 1, 2].map((i) => <Skeleton key={i} className="size-12 rounded-lg" />)}</div></div>;
  const hero = p.images[0] ?? p.coverImage;
  return (
    <div className="flex gap-2 md:flex-col">
      <Thumb src={hero} tint={p.tint} alt={p.name} size="hero" className="size-28 md:size-40" />
      <div className="flex gap-2 md:flex-row" aria-label="More images">
        {[1, 2, 3].map((i) => <Thumb key={i} src={p.images[i]} tint={p.tint} alt="" size="md" className="size-12 opacity-80" />)}
      </div>
    </div>
  );
}

function Kpis({ p, isManager }: { p: ProductDetail | undefined; isManager: boolean }) {
  if (!p) return <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5"><SkeletonKpis count={isManager ? 5 : 3} /></div>;
  const units = p.variants.reduce((a, v) => a + v.quantity, 0);
  const costUnits = p.variants.reduce((a, v) => a + (v.costPrice !== undefined ? v.quantity : 0), 0);
  const avgCost = costUnits > 0 ? Math.round(p.variants.reduce((a, v) => a + (v.costPrice ?? 0) * v.quantity, 0) / costUnits) : p.defaultCost;
  const margin = p.marginPct ?? marginPct(p.defaultPrice, avgCost);
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
      <KpiCard compact label="Price" value={formatMoney(p.defaultPrice)} sub="EGP" />
      {isManager && <KpiCard compact label="Avg cost" value={avgCost !== undefined ? formatMoney(avgCost) : '—'} sub="weighted" />}
      {isManager && <KpiCard compact label="Margin" value={margin !== undefined ? formatPct(margin) : '—'} />}
      <KpiCard compact label="In stock" value={<span aria-live="polite">{formatNumber(units)}</span>} unit="units" sub={`${p.variantCount} variants · ${p.lowCount} low · ${p.outCount} out`} />
      <KpiCard compact label="Sold 30d" value={formatNumber(p.soldLast30d)} unit="units" />
    </div>
  );
}
