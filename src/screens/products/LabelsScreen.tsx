'use client';
/**
 * Screen: /labels · Roles: ADMIN, MANAGER (products.write)
 * Calls: GET /labels?variantIds= · GET /products/:id (when ?productId=) · GET /variants/search (add) ·
 * GET /settings (store name for the logo line).
 * Layout: left column (variants, copies mode, template, options) is `.no-print`; the right preview is
 * the `.print-area` printed by window.print() using the global print-labels-* classes.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Printer, Tag, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { LogoMark } from '@/components/app/Brand';
import { LabelCard } from '@/components/app/Receipt';
import { Button } from '@/components/ui/Button';
import { Checkbox, Segmented } from '@/components/ui/Field';
import { QuantityInput, SearchInput } from '@/components/ui/Controls';
import { ColorSwatch } from '@/components/ui/Badge';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/States';
import type { ProductDetail, Variant, VariantWithProduct } from '@/types';
import { printOrShare } from '@/lib/print-share';

type CopiesMode = 'onhand' | 'variant' | 'custom';
type Template = 'a4' | 'thermal';
interface Line { v: VariantWithProduct; copies: number }

const A4_PER_SHEET = 24;

function withProduct(v: Variant, p: ProductDetail): VariantWithProduct {
  return { ...v, product: { id: p.id, name: p.name, baseSku: p.baseSku, images: p.images, brandName: p.brand.name, tint: p.tint } };
}

export function LabelsScreen() {
  const sp = useSearchParams();
  const productId = sp.get('productId') ?? undefined;
  const idsParam = sp.get('variantIds') ?? '';
  const initial = useApi(async () => {
    if (productId) { const p = await api.products.get(productId); return p.variants.map((v) => withProduct(v, p)); }
    const ids = idsParam.split(',').filter(Boolean);
    return ids.length ? api.labels(ids) : [];
  }, [productId, idsParam]);
  const settings = useApi(() => api.settings.get(), []);

  const [lines, setLines] = useState<Line[]>([]);
  const [mode, setMode] = useState<CopiesMode>('onhand');
  const [template, setTemplate] = useState<Template>('a4');
  const [showPrice, setShowPrice] = useState(true);
  const [showVariant, setShowVariant] = useState(true);
  const [showLogo, setShowLogo] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const search = useApi(() => api.variants.search(dq, 8), [dq], { enabled: dq.trim().length >= 2 });

  useEffect(() => { if (initial.data) setLines(initial.data.map((v) => ({ v, copies: Math.max(1, v.quantity) }))); }, [initial.data]);

  const copiesFor = (l: Line) => mode === 'onhand' ? Math.max(0, l.v.quantity) : mode === 'variant' ? 1 : l.copies;
  const labels = useMemo(() => lines.flatMap((l) => Array.from({ length: copiesFor(l) }, (_, i) => ({ key: `${l.v.id}-${i}`, v: l.v }))), [lines, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = labels.length;
  const sheets = Math.ceil(total / A4_PER_SHEET);

  const add = (v: VariantWithProduct) => { setLines((ls) => ls.some((l) => l.v.id === v.id) ? ls : [...ls, { v, copies: Math.max(1, v.quantity) }]); setQ(''); };
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.v.id !== id));
  const removeProduct = (pid: string) => setLines((ls) => ls.filter((l) => l.v.product.id !== pid));
  const setCopies = (id: string, n: number) => setLines((ls) => ls.map((l) => (l.v.id === id ? { ...l, copies: n } : l)));

  // group by product for the list
  const groups = useMemo(() => { const m = new Map<string, Line[]>(); for (const l of lines) { const arr = m.get(l.v.product.id) ?? []; arr.push(l); m.set(l.v.product.id, arr); } return [...m.values()]; }, [lines]);
  const summary = template === 'a4' ? `A4 · ${total} label${total === 1 ? '' : 's'} · ${sheets} sheet${sheets === 1 ? '' : 's'}` : `Thermal · ${total} label${total === 1 ? '' : 's'}`;

  return (
    <>
      <PageHeader className="no-print" title="Print labels" back="/products" crumbs={[{ label: 'Products', href: '/products' }, { label: 'Print labels' }]}
        actions={<Button variant="primary" leading={<Printer />} disabled={total === 0} onClick={() => void printOrShare('labels')}>Print {total} label{total === 1 ? '' : 's'}</Button>} />
      <Page wide className="print:p-0">
        <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
          <div className="no-print flex flex-col gap-4">
            {/* 1 · Variants */}
            <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <h2 className="text-[15px] font-semibold">1 · Variants</h2>
              <div className="relative">
                <SearchInput value={q} onChange={setQ} placeholder="Add product or variant" aria-label="Add variants" />
                {dq.trim().length >= 2 && (
                  <div role="listbox" className="absolute z-20 mt-1 w-full rounded-card border border-line bg-surface p-1.5 shadow-float">
                    {search.loading && !search.data ? <p className="px-3 py-2 text-sm text-ink-2">Searching…</p> : search.error ? <p className="px-3 py-2 text-sm text-danger-ink">{search.error.message}</p> : (search.data ?? []).length === 0 ? <p className="px-3 py-2 text-sm text-ink-2">No variants match “{dq}”.</p> : (search.data ?? []).map((v) => (
                      <button key={v.id} type="button" role="option" aria-selected={false} onClick={() => add(v)} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-surface-2">
                        <ColorSwatch hex={v.color.hex} name={v.color.name} /><span className="min-w-0 flex-1 truncate">{v.product.name} · {v.size} · {v.color.name}</span><span className="tabular text-xs text-ink-2">{v.sku}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {initial.initial ? <SkeletonRows rows={4} /> : initial.error && lines.length === 0 ? <ErrorState error={initial.error} onRetry={() => void initial.refetch()} compact /> : lines.length === 0 ? <EmptyState compact icon={<Tag aria-hidden />} title="No variants yet" body="Search above to add a product or a single variant." /> : (
                <ul className="flex flex-col divide-y divide-line">
                  {groups.map((g) => {
                    const first = g[0];
                    if (!first) return null;
                    const onHand = g.reduce((a, l) => a + l.v.quantity, 0);
                    return (
                      <li key={first.v.product.id} className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{first.v.product.name}</p><p className="text-xs text-ink-2">{g.length} variant{g.length === 1 ? '' : 's'} · {onHand} on hand</p></div>
                          <span className="tabular text-sm font-semibold">{g.reduce((a, l) => a + copiesFor(l), 0)}</span>
                          <Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${first.v.product.name}`} onClick={() => removeProduct(first.v.product.id)}><X /></Button>
                        </div>
                        <ul className="mt-1 flex flex-col">
                          {g.map((l) => (
                            <li key={l.v.id} className="flex min-h-9 items-center gap-2 pl-2 text-sm">
                              <ColorSwatch hex={l.v.color.hex} name={l.v.color.name} />
                              <span className="min-w-0 flex-1 truncate">{l.v.size} · {l.v.color.name} <span className="tabular text-xs text-ink-2">{l.v.sku}</span></span>
                              {mode === 'custom' ? <QuantityInput size="sm" value={l.copies} onChange={(n) => setCopies(l.v.id, n)} aria-label={`Copies for ${l.v.sku}`} /> : <span className="tabular w-8 text-right text-ink-2">{copiesFor(l)}</span>}
                              <Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${l.v.sku}`} onClick={() => remove(l.v.id)}><X /></Button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Segmented grow aria-label="Copies" value={mode} onChange={setMode} options={[{ value: 'onhand', label: '1 per unit on hand' }, { value: 'variant', label: '1 per variant' }, { value: 'custom', label: 'Custom' }]} />
            </section>

            {/* 2 · Template */}
            <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <h2 className="text-[15px] font-semibold">2 · Template</h2>
              <div role="radiogroup" aria-label="Label template" className="grid grid-cols-2 gap-3">
                <TemplateCard selected={template === 'a4'} onSelect={() => setTemplate('a4')} label="A4 grid · 3×8 (24/sheet)" preview={<div className="grid grid-cols-3 gap-0.5">{Array.from({ length: 6 }).map((_, i) => <i key={i} className="h-2.5 rounded-[2px] bg-ink-3/40" />)}</div>} />
                <TemplateCard selected={template === 'thermal'} onSelect={() => { setTemplate('thermal'); setShowLogo(false); }} label="Thermal 40×30 mm" preview={<i className="mx-auto block h-6 w-8 rounded-[2px] bg-ink-3/40" />} />
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <Checkbox checked={showPrice} onChange={setShowPrice} label="Show price" />
                <Checkbox checked={showVariant} onChange={setShowVariant} label="Show size · color" />
                <Checkbox checked={showLogo} onChange={setShowLogo} label="Show store logo" disabled={template === 'thermal'} />
              </div>
              {template === 'thermal' && <p className="text-xs text-ink-2">The store logo does not fit on a 40×30 mm label.</p>}
            </section>
          </div>

          {/* 3 · Preview */}
          <section aria-label="Print preview" className="flex flex-col gap-3">
            <div className="no-print flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">3 · Preview</h2>
              <span className="tabular text-xs text-ink-2">{summary}</span>
            </div>
            <div className="print-area rounded-card border border-line bg-surface-2 p-3 print:border-0 print:bg-transparent print:p-0">
              {initial.initial ? <Skeleton className="h-64 rounded-lg" /> : total === 0 ? <EmptyState compact icon={<Printer aria-hidden />} title="Nothing to print" body={lines.length ? 'Every selected variant has 0 on hand. Switch copies to “1 per variant” or “Custom”.' : 'Add variants on the left to see the labels.'} /> : (
                <div className={cn('mx-auto bg-white p-3 print:p-0', template === 'a4' ? 'print-labels-a4 grid max-w-[210mm] grid-cols-3 gap-2' : 'print-labels-thermal flex flex-wrap gap-2')}>
                  {labels.map((l) => (
                    <div key={l.key} className="flex flex-col">
                      {showLogo && template === 'a4' && <p className="eyebrow flex items-center gap-1 truncate px-2 pt-1 text-[8px]"><LogoMark size={10} variant="mono" className="text-[#3F6B5C]" />{settings.data?.storeName ?? 'Avenue'}</p>}
                      <LabelCard name={l.v.product.name} variant={`${l.v.size} · ${l.v.color.name}`} sku={l.v.sku} barcode={l.v.barcode} price={l.v.sellPrice} showPrice={showPrice} showVariant={showVariant} thermal={template === 'thermal'} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </Page>
    </>
  );
}

function TemplateCard({ selected, onSelect, label, preview }: { selected: boolean; onSelect: () => void; label: string; preview: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className={cn('flex flex-col gap-2 rounded-card border p-3 text-left text-sm transition-colors', selected ? 'border-accent bg-accent-soft/60 ring-2 ring-accent-soft' : 'border-line bg-surface hover:bg-surface-2')}>
      <div className="rounded-md bg-surface-2 p-2">{preview}</div>
      <span className="flex items-center gap-2"><span aria-hidden className={cn('flex size-4 items-center justify-center rounded-full border-[1.5px]', selected ? 'border-accent' : 'border-ink-3')}>{selected && <span className="size-2 rounded-full bg-accent" />}</span>{label}</span>
    </button>
  );
}
