'use client';
/**
 * Filter controls for /products: chip menus (desktop / tablet), the "More filters" price panel
 * and the mobile "Filters · n" sheet. Pure UI — the list screen owns the state.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { Chip, ColorSwatch } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, MoneyInput, Select } from '@/components/ui/Field';
import { MenuItem, Panel, Popover, Sheet } from '@/components/ui/Overlay';
import { Segmented } from '@/components/ui/Field';
import type { Brand, Category, ColorRef } from '@/types';
import { STATUS_FILTER_LABEL, STOCK_FILTER_LABEL } from './products-shared';

export type StockFilter = 'in' | 'low' | 'out';
export type StatusFilter = 'ACTIVE' | 'ARCHIVED' | 'ALL';

export interface ProductFilterState {
  brandId?: string;
  categoryId?: string;
  size?: string;
  color?: string;
  stock?: StockFilter;
  status: StatusFilter;
  minPrice?: number;
  maxPrice?: number;
}

export const EMPTY_FILTERS: ProductFilterState = { status: 'ACTIVE' };

export function activeFilterCount(f: ProductFilterState): number {
  return [f.brandId, f.categoryId, f.size, f.color, f.stock, f.minPrice, f.maxPrice].filter((v) => v !== undefined).length + (f.status !== 'ACTIVE' ? 1 : 0);
}

/** One sentence naming the active filters, for empty states. */
export function describeFilters(f: ProductFilterState, q: string, brands: Brand[], categories: Category[]): string {
  const parts: string[] = [];
  if (q) parts.push(`“${q}”`);
  const b = brands.find((x) => x.id === f.brandId); if (b) parts.push(b.name);
  const c = categories.find((x) => x.id === f.categoryId); if (c) parts.push(c.name);
  if (f.size) parts.push(`size ${f.size}`);
  if (f.color) parts.push(f.color);
  if (f.stock) parts.push(STOCK_FILTER_LABEL[f.stock].toLowerCase());
  if (f.status !== 'ACTIVE') parts.push(STATUS_FILTER_LABEL[f.status].toLowerCase());
  if (f.minPrice !== undefined || f.maxPrice !== undefined) parts.push(`price ${f.minPrice !== undefined ? formatMoney(f.minPrice, 'EGP', { compact: true }) : '0'}–${f.maxPrice !== undefined ? formatMoney(f.maxPrice, 'EGP', { compact: true }) : '∞'}`);
  return parts.length ? `No products match ${parts.join(' · ')}.` : 'No products yet.';
}

export interface FilterSources { brands: Brand[]; categories: Category[]; sizes: string[]; colors: ColorRef[] }

/* ---------- chip + popover menu ---------- */
function ChipMenu<T extends string>({ label, value, valueLabel, options, onChange, leading }: { label: string; value: T | undefined; valueLabel?: string; options: { value: T; label: string; leading?: ReactNode }[]; onChange: (v: T | undefined) => void; leading?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const active = value !== undefined;
  return (
    <Popover open={open} onClose={() => setOpen(false)} align="start" className="max-h-80 overflow-y-auto"
      anchor={<Chip selected={active} onClick={() => setOpen((o) => !o)} leading={leading} aria-label={active ? `${label}: ${valueLabel ?? value}` : label}>{active ? `${label}: ${valueLabel ?? value}` : label}<ChevronDown className="size-3.5 opacity-60" aria-hidden /></Chip>}>
      <MenuItem selected={!active} onClick={() => { onChange(undefined); setOpen(false); }}>Any {label.toLowerCase()}</MenuItem>
      <div className="my-1 h-px bg-line" />
      {options.map((o) => <MenuItem key={o.value} selected={o.value === value} onClick={() => { onChange(o.value); setOpen(false); }}>{o.leading}{o.label}</MenuItem>)}
    </Popover>
  );
}

/* ---------- desktop / tablet chip row ---------- */
export function ProductFilterChips({ filters, onChange, sources, onMore, compact }: { filters: ProductFilterState; onChange: (f: ProductFilterState) => void; sources: FilterSources; onMore: () => void; compact?: boolean }) {
  const set = <K extends keyof ProductFilterState>(k: K, v: ProductFilterState[K]) => onChange({ ...filters, [k]: v });
  const priceActive = filters.minPrice !== undefined || filters.maxPrice !== undefined;
  const priceLabel = priceActive ? `Price: ${filters.minPrice !== undefined ? formatMoney(filters.minPrice, 'EGP', { compact: true }) : '0'}–${filters.maxPrice !== undefined ? formatMoney(filters.maxPrice, 'EGP', { compact: true }) : '∞'}` : 'Price';
  return (
    <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto py-0.5" role="group" aria-label="Filters">
      <ChipMenu label="Brand" value={filters.brandId} valueLabel={sources.brands.find((b) => b.id === filters.brandId)?.name} options={sources.brands.map((b) => ({ value: b.id, label: b.name }))} onChange={(v) => set('brandId', v)} />
      <ChipMenu label="Category" value={filters.categoryId} valueLabel={sources.categories.find((c) => c.id === filters.categoryId)?.name} options={sources.categories.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => set('categoryId', v)} />
      {!compact && <ChipMenu label="Size" value={filters.size} options={sources.sizes.map((s) => ({ value: s, label: s }))} onChange={(v) => set('size', v)} />}
      {!compact && <ChipMenu label="Color" value={filters.color} options={sources.colors.map((c) => ({ value: c.name, label: c.name, leading: <ColorSwatch hex={c.hex} name={c.name} /> }))} onChange={(v) => set('color', v)} />}
      <ChipMenu label="Stock" value={filters.stock} valueLabel={filters.stock && STOCK_FILTER_LABEL[filters.stock]} options={(['in', 'low', 'out'] as StockFilter[]).map((s) => ({ value: s, label: STOCK_FILTER_LABEL[s] }))} onChange={(v) => set('stock', v)} />
      {!compact && <Chip selected={priceActive} onClick={onMore}>{priceLabel}</Chip>}
      <ChipMenu label="Status" value={filters.status} valueLabel={STATUS_FILTER_LABEL[filters.status]} options={(['ACTIVE', 'ARCHIVED', 'ALL'] as StatusFilter[]).map((s) => ({ value: s, label: STATUS_FILTER_LABEL[s] }))} onChange={(v) => set('status', v ?? 'ACTIVE')} />
      <Chip onClick={onMore} leading={<SlidersHorizontal className="size-3.5" aria-hidden />}>{compact ? 'More' : 'More filters'}</Chip>
    </div>
  );
}

/* ---------- "More filters" (price range) panel ---------- */
export function MoreFiltersPanel({ open, onClose, filters, onChange }: { open: boolean; onClose: () => void; filters: ProductFilterState; onChange: (f: ProductFilterState) => void }) {
  const [min, setMin] = useState<number | undefined>(filters.minPrice);
  const [max, setMax] = useState<number | undefined>(filters.maxPrice);
  const invalid = min !== undefined && max !== undefined && min > max;
  return (
    <Panel open={open} onClose={onClose} title="More filters" description="Price range applies to the default sell price."
      footer={<div className="flex justify-between gap-2"><Button variant="ghost" onClick={() => { setMin(undefined); setMax(undefined); onChange({ ...filters, minPrice: undefined, maxPrice: undefined }); onClose(); }}>Clear</Button><Button variant="primary" disabled={invalid} onClick={() => { onChange({ ...filters, minPrice: min, maxPrice: max }); onClose(); }}>Apply</Button></div>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Min price" htmlFor="f-min"><MoneyInput id="f-min" value={min} onChange={setMin} placeholder="0.00" /></Field>
        <Field label="Max price" htmlFor="f-max" error={invalid ? 'Max must be at least the min' : undefined}><MoneyInput id="f-max" value={max} onChange={setMax} placeholder="∞" invalid={invalid} /></Field>
      </div>
    </Panel>
  );
}

/* ---------- mobile: all filters in one sheet ---------- */
export function MobileFiltersSheet({ open, onClose, filters, onChange, sources, sort, onSort, sortOptions, showStatus }: { open: boolean; onClose: () => void; filters: ProductFilterState; onChange: (f: ProductFilterState) => void; sources: FilterSources; sort: string; onSort: (s: string) => void; sortOptions: { value: string; label: string }[]; showStatus: boolean }) {
  const [draft, setDraft] = useState<ProductFilterState>(filters);
  const [draftSort, setDraftSort] = useState(sort);
  const set = <K extends keyof ProductFilterState>(k: K, v: ProductFilterState[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const invalid = draft.minPrice !== undefined && draft.maxPrice !== undefined && draft.minPrice > draft.maxPrice;
  return (
    <Sheet open={open} onClose={onClose} title="Filters" full
      footer={<div className="flex gap-2"><Button size="lg" className="flex-1" onClick={() => { setDraft(EMPTY_FILTERS); setDraftSort('-updated'); }}>Clear all</Button><Button size="lg" variant="primary" className="flex-1" disabled={invalid} onClick={() => { onChange(draft); onSort(draftSort); onClose(); }}>Show products</Button></div>}>
      <div className="flex flex-col gap-5 pt-2">
        <Field label="Sort" htmlFor="mf-sort"><Select id="mf-sort" size="lg" value={draftSort} onChange={(e) => setDraftSort(e.target.value)}>{sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
        <Field label="Brand" htmlFor="mf-brand"><Select id="mf-brand" size="lg" value={draft.brandId ?? ''} onChange={(e) => set('brandId', e.target.value || undefined)}><option value="">Any brand</option>{sources.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Category" htmlFor="mf-cat"><Select id="mf-cat" size="lg" value={draft.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || undefined)}><option value="">Any category</option>{sources.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <fieldset className="flex flex-col gap-2"><legend className="text-[13px] font-medium">Size</legend><div className="flex flex-wrap gap-2">{sources.sizes.map((s) => <Chip key={s} size="touch" selected={draft.size === s} onClick={() => set('size', draft.size === s ? undefined : s)}>{s}</Chip>)}</div></fieldset>
        <fieldset className="flex flex-col gap-2"><legend className="text-[13px] font-medium">Color</legend><div className="flex flex-wrap gap-2">{sources.colors.map((c) => <Chip key={c.name} size="touch" selected={draft.color === c.name} onClick={() => set('color', draft.color === c.name ? undefined : c.name)} leading={<ColorSwatch hex={c.hex} name={c.name} />}>{c.name}</Chip>)}</div></fieldset>
        <fieldset className="flex flex-col gap-2"><legend className="text-[13px] font-medium">Stock</legend><Segmented grow size="lg" aria-label="Stock status" value={draft.stock ?? 'any'} onChange={(v) => set('stock', v === 'any' ? undefined : (v as StockFilter))} options={[{ value: 'any', label: 'Any' }, { value: 'in', label: 'In stock' }, { value: 'low', label: 'Low' }, { value: 'out', label: 'Out' }]} /></fieldset>
        {showStatus && <fieldset className="flex flex-col gap-2"><legend className="text-[13px] font-medium">Status</legend><Segmented grow size="lg" aria-label="Product status" value={draft.status} onChange={(v) => set('status', v)} options={(['ACTIVE', 'ARCHIVED', 'ALL'] as StatusFilter[]).map((s) => ({ value: s, label: STATUS_FILTER_LABEL[s] }))} /></fieldset>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min price" htmlFor="mf-min"><MoneyInput id="mf-min" size="lg" value={draft.minPrice} onChange={(v) => set('minPrice', v)} placeholder="0.00" /></Field>
          <Field label="Max price" htmlFor="mf-max" error={invalid ? 'Max must be at least the min' : undefined}><MoneyInput id="mf-max" size="lg" value={draft.maxPrice} onChange={(v) => set('maxPrice', v)} placeholder="∞" invalid={invalid} /></Field>
        </div>
      </div>
    </Sheet>
  );
}
