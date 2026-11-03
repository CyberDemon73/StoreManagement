'use client';
/**
 * Screen: /products · Roles: ADMIN, MANAGER, SELLER (sellers: no cost/margin, no bulk select,
 * no New product; cards expand to a mini matrix with "Sell this").
 * Calls: GET /products?q&brandId&categoryId&size&color&stock&minPrice&maxPrice&status&sort&page&pageSize ·
 * GET /products/:id (quick view) · GET /brands · GET /categories · GET /settings (size/colour options) ·
 * GET /products/export · bulk: POST /products/:id/archive · PATCH /products/:id.
 * Layout: desktop table + quick-view drawer · tablet list/detail split · mobile cards + filter sheet.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowUpDown, Download, Package, Plus, SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useBreakpoint, useDebounced } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime, formatMoney, formatPct } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Button, LinkButton } from '@/components/ui/Button';
import { Badge, Chip, Thumb } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/States';
import { MenuItem, Panel, Popover } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import type { ProductListItem } from '@/types';
import { ProductStatusBadge, ProductSummary, SORT_OPTIONS, sortLabel, STATUS_FILTER_LABEL, STOCK_FILTER_LABEL, productStock, useCatalog } from './products-shared';
import { activeFilterCount, describeFilters, EMPTY_FILTERS, MobileFiltersSheet, MoreFiltersPanel, ProductFilterChips, type ProductFilterState, type StockFilter } from './ProductsFilters';
import { ProductBulkBar } from './ProductBulkBar';
import { MobileCards, TabletSplit } from './ProductsListViews';

const STOCK_VALUES: StockFilter[] = ['in', 'low', 'out'];

export function ProductsListScreen() {
  const auth = useAuth();
  const bp = useBreakpoint();
  const sp = useSearchParams();
  const { toast } = useToast();
  const isManager = auth.isManager;
  const canWrite = auth.can('products.write');
  const canReceive = auth.can('stock.receive');

  const [q, setQ] = useState(sp.get('q') ?? '');
  const dq = useDebounced(q, 300);
  const [filters, setFilters] = useState<ProductFilterState>(() => {
    const stock = sp.get('stock');
    return { ...EMPTY_FILTERS, brandId: sp.get('brandId') ?? undefined, stock: STOCK_VALUES.find((s) => s === stock) };
  });
  const [sort, setSort] = useState('-updated');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quickId, setQuickId] = useState<string>();
  const [tabletId, setTabletId] = useState<string>();
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const catalog = useCatalog();
  const filterKey = JSON.stringify(filters);
  useEffect(() => { setPage(1); }, [dq, filterKey, sort]);

  const list = useApi(() => api.products.list({ q: dq || undefined, ...filters, sort, page, pageSize }), [dq, filterKey, sort, page, pageSize]);
  const rows = list.data?.data;
  const total = list.data?.total ?? 0;
  useEffect(() => { if (rows && rows.length > 0 && !rows.some((r) => r.id === tabletId)) setTabletId(rows[0]?.id); }, [rows, tabletId]);

  const quick = useApi(() => api.products.get(quickId ?? ''), [quickId], { enabled: !!quickId });
  const activeCount = activeFilterCount(filters) + (dq ? 1 : 0);
  const emptyBody = describeFilters(filters, dq, catalog.brands, catalog.categories);
  const clearAll = () => { setFilters(EMPTY_FILTERS); setQ(''); };

  const exportCsv = async () => {
    setExporting(true);
    try { const url = await api.products.exportCsv(); window.open(url, '_blank', 'noopener'); toast({ kind: 'success', title: 'Export ready', body: 'The CSV opened in a new tab.' }); } catch (e) { toast({ kind: 'error', title: 'Export failed', body: (e as Error).message }); } finally { setExporting(false); }
  };

  const sortState = useMemo(() => ({ key: sort.replace(/^-/, ''), desc: sort.startsWith('-') }), [sort]);
  const columns = useMemo<Column<ProductListItem>[]>(() => [
    { key: 'thumb', header: '', width: '48px', cell: (p) => <Thumb src={p.coverImage} tint={p.tint} size="sm" alt="" /> },
    { key: 'name', header: 'Product', sortable: true, cell: (p) => <span className="block min-w-[160px]"><span className="block font-medium">{p.name}</span><span className="tabular block text-xs text-ink-2">{p.baseSku}</span></span> },
    { key: 'brand', header: 'Brand', cell: (p) => p.brand.name },
    { key: 'category', header: 'Category', cell: (p) => <span className="text-ink-2">{p.category.name}</span> },
    { key: 'variants', header: 'Variants', align: 'right', cell: (p) => p.variantCount },
    { key: 'qty', header: 'Total qty', align: 'right', sortable: true, cell: (p) => <span className="font-medium">{p.totalQty}</span> },
    { key: 'cost', header: 'Cost', align: 'right', when: isManager, cell: (p) => p.defaultCost !== undefined ? formatMoney(p.defaultCost) : '—' },
    { key: 'price', header: 'Price', align: 'right', sortable: true, cell: (p) => <span className="font-medium">{formatMoney(p.defaultPrice)}</span> },
    { key: 'margin', header: 'Margin', align: 'right', when: isManager, cell: (p) => p.marginPct !== undefined ? formatPct(p.marginPct) : '—' },
    { key: 'status', header: 'Status', cell: (p) => <RowStatus p={p} /> },
    { key: 'updated', header: 'Updated', sortable: true, cell: (p) => <span className="tabular whitespace-nowrap text-ink-2">{formatDateTime(p.updatedAt)}</span> },
  ], [isManager]);

  const listState = { rows, loading: list.loading, initial: list.initial, error: list.error, refetch: () => void list.refetch(), total };
  const pager = { page, pageSize, total, onPage: setPage, onPageSize: (n: number) => { setPageSize(n); setPage(1); } };
  const sources = { brands: catalog.brands, categories: catalog.categories, sizes: catalog.sizes, colors: catalog.colors };

  const sortMenu = (
    <Popover open={sortOpen} onClose={() => setSortOpen(false)} anchor={<Button size="sm" leading={<ArrowUpDown />} aria-haspopup="menu" aria-expanded={sortOpen} onClick={() => setSortOpen((o) => !o)}>Sort: {sortLabel(sort)}</Button>}>
      {SORT_OPTIONS.map((o) => <MenuItem key={o.value} selected={o.value === sort} onClick={() => { setSort(o.value); setSortOpen(false); }}>{o.label}</MenuItem>)}
    </Popover>
  );

  return (
    <>
      <PageHeader title="Products" crumbs={[{ label: 'Catalog' }, { label: 'Products' }]} description={list.data ? `${total} product${total === 1 ? '' : 's'}` : undefined}
        actions={<>
          {auth.can('export.csv') && bp !== 'mobile' && <Button leading={<Download />} loading={exporting} onClick={() => void exportCsv()}>Export CSV</Button>}
          {canWrite && (bp === 'mobile' ? <LinkButton variant="primary" iconOnly aria-label="New product" href="/products/new"><Plus /></LinkButton> : <LinkButton variant="primary" leading={<Plus />} href="/products/new">New product</LinkButton>)}
        </>} />
      <Page wide>
        {/* search + filters */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <SearchInput value={q} onChange={setQ} placeholder="Name, SKU or barcode" aria-label="Search products" className="flex-1 md:max-w-md" size={bp === 'mobile' ? 'lg' : 'md'} />
            {bp === 'desktop' && <div className="ml-auto flex items-center gap-2">{sortMenu}</div>}
          </div>
          {bp === 'mobile' ? (
            <div className="scrollbar-none -mx-4 flex items-center gap-1.5 overflow-x-auto px-4">
              <Chip selected={activeCount > 0} onClick={() => setMobileOpen(true)} leading={<SlidersHorizontal className="size-3.5" aria-hidden />}>{activeCount > 0 ? `Filters · ${activeCount}` : 'Filters'}</Chip>
              <ActiveChips filters={filters} onChange={setFilters} sources={sources} />
              {!filters.categoryId && <Chip onClick={() => setMobileOpen(true)}>Category</Chip>}
              {!filters.size && <Chip onClick={() => setMobileOpen(true)}>Size</Chip>}
              {!filters.color && <Chip onClick={() => setMobileOpen(true)}>Color</Chip>}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <ProductFilterChips filters={filters} onChange={setFilters} sources={sources} onMore={() => setMoreOpen(true)} compact={bp === 'tablet'} />
              {bp === 'tablet' && <div className="ml-auto shrink-0">{sortMenu}</div>}
            </div>
          )}
        </div>

        {isManager && bp === 'desktop' && <ProductBulkBar selected={[...selected]} onClear={() => setSelected(new Set())} onDone={() => void list.refetch()} categories={catalog.categories} />}

        {bp === 'mobile' ? (
          <MobileCards list={listState} seller={!isManager} emptyBody={emptyBody} onClearFilters={clearAll} hasFilters={activeCount > 0} onLoadMore={() => setPageSize((n) => n + 25)} />
        ) : bp === 'tablet' ? (
          <TabletSplit list={listState} selectedId={tabletId} onSelect={setTabletId} emptyBody={emptyBody} onClearFilters={clearAll} hasFilters={activeCount > 0} isManager={isManager} canEdit={canWrite} canReceive={canReceive}
            pager={<div className="flex items-center justify-between text-xs text-ink-2"><span className="tabular">{total === 0 ? '0 results' : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}`}</span><div className="flex gap-1"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>Next</Button></div></div>} />
        ) : (
          <DataTable aria-label="Products" columns={columns} rows={rows} rowKey={(p) => p.id} loading={list.loading} error={list.error} onRetry={() => void list.refetch()}
            onRowClick={(p) => setQuickId(p.id)} selectedKeys={isManager ? selected : undefined} onSelectionChange={isManager ? setSelected : undefined}
            sort={sortState} onSortChange={(s) => setSort(`${s.desc ? '-' : ''}${s.key}`)} page={pager}
            empty={<EmptyState compact icon={<Package aria-hidden />} title="No products" body={emptyBody} action={activeCount > 0 ? <Button size="sm" onClick={clearAll}>Clear filters</Button> : canWrite ? <LinkButton size="sm" variant="primary" href="/products/new">New product</LinkButton> : undefined} />} />
        )}
        {!isManager && bp === 'mobile' && <p className="text-center text-xs text-ink-2">Price and stock only. Cost and margin are not shown to sellers.</p>}
      </Page>

      {/* quick view */}
      <Panel open={!!quickId} onClose={() => setQuickId(undefined)} title={quick.data?.name ?? rows?.find((r) => r.id === quickId)?.name ?? 'Quick view'} description="Quick view">
        <ProductSummary product={quick.data} loading={quick.loading} error={quick.error} onRetry={() => void quick.refetch()} isManager={isManager} canEdit={canWrite} canReceive={canReceive} />
      </Panel>
      {moreOpen && <MoreFiltersPanel open onClose={() => setMoreOpen(false)} filters={filters} onChange={setFilters} />}
      {mobileOpen && <MobileFiltersSheet open onClose={() => setMobileOpen(false)} filters={filters} onChange={setFilters} sources={sources} sort={sort} onSort={setSort} sortOptions={SORT_OPTIONS} showStatus={isManager} />}
    </>
  );
}

function RowStatus({ p }: { p: ProductListItem }) {
  if (p.status === 'ARCHIVED') return <ProductStatusBadge status={p.status} />;
  const st = productStock(p);
  if (st === 'out') return <Badge tone="danger" dot>Out of stock</Badge>;
  if (st === 'low') return <Badge tone="warn" dot>Low stock</Badge>;
  return <Badge tone="ok" dot>Active</Badge>;
}

/** Removable chips for the active filters (mobile row). */
function ActiveChips({ filters, onChange, sources }: { filters: ProductFilterState; onChange: (f: ProductFilterState) => void; sources: { brands: { id: string; name: string }[]; categories: { id: string; name: string }[] } }) {
  const chips: { key: keyof ProductFilterState; label: string }[] = [];
  const b = sources.brands.find((x) => x.id === filters.brandId); if (b) chips.push({ key: 'brandId', label: b.name });
  const c = sources.categories.find((x) => x.id === filters.categoryId); if (c) chips.push({ key: 'categoryId', label: c.name });
  if (filters.size) chips.push({ key: 'size', label: filters.size });
  if (filters.color) chips.push({ key: 'color', label: filters.color });
  if (filters.stock) chips.push({ key: 'stock', label: STOCK_FILTER_LABEL[filters.stock] });
  if (filters.status !== 'ACTIVE') chips.push({ key: 'status', label: STATUS_FILTER_LABEL[filters.status] });
  return <>{chips.map((ch) => <Chip key={ch.key} selected onRemove={() => onChange({ ...filters, [ch.key]: ch.key === 'status' ? 'ACTIVE' : undefined })}>{ch.label}</Chip>)}</>;
}
