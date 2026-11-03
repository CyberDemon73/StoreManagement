'use client';
/**
 * Sections of the product form (Basics, Images, Variants, Pricing, Review). Shared by the desktop
 * single page and the mobile stepper in ProductEditScreen. Only Basics talks to the API
 * (POST /brands through the onCreateBrand callback).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, CircleAlert, ImagePlus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { formatMoney, formatPct, marginPct } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Field';
import { Combobox } from '@/components/ui/Controls';
import { Badge, Chip, ColorSwatch, Thumb } from '@/components/ui/Badge';
import { KpiCard } from '@/components/ui/Card';
import { VariantMatrix } from '@/components/app/VariantMatrix';
import { BarcodeCaptureButton } from '@/components/app/BarcodeScanner';
import { hexFromColorName } from '@/lib/color-name';
import { colorChoices } from '@/lib/colors';
import { sizeGroups } from '@/lib/sizes';
import type { Brand, Category, ColorRef, Settings } from '@/types';
import { type Derived, type FormErrors, type ProductFormState, type SectionCheck, variantSku } from './product-form';

export interface SectionProps { form: ProductFormState; set: (patch: Partial<ProductFormState>) => void; errors: FormErrors }

export function SectionCard({ title, id, children, hint }: { title: string; id: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:p-5">
      <h2 id={id} className="text-[15px] font-semibold">{title}</h2>
      {children}
      {hint && <p className="text-xs text-ink-2">{hint}</p>}
    </section>
  );
}

/* ---------- 1 · Basics ---------- */
export function BasicsSection({ form, set, errors, brands, categories, onCreateBrand }: SectionProps & { brands: Brand[]; categories: Category[]; onCreateBrand: (name: string) => Promise<void> }) {
  const [tag, setTag] = useState('');
  const uid = useId();
  const addTag = () => { const t = tag.trim().replace(/,+$/, ''); if (t && !form.tags.includes(t)) set({ tags: [...form.tags, t] }); setTag(''); };
  const firstSize = form.sizes[0] ?? 'M';
  const firstColor = form.colors[0]?.name ?? 'Black';
  return (
    <>
      <Field label="Product name" htmlFor={`${uid}-name`} error={errors.name}><Input id={`${uid}-name`} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Linen Shirt Relaxed" invalid={!!errors.name} autoComplete="off" /></Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Brand" htmlFor={`${uid}-brand`} error={errors.brandId}>
          <Combobox aria-label="Brand" value={form.brandId || undefined} onChange={(v) => set({ brandId: v })} options={brands.filter((b) => b.isActive).map((b) => ({ value: b.id, label: b.name, hint: b.productCount !== undefined ? `${b.productCount}` : undefined }))} placeholder="Search or create a brand" onCreate={(name) => void onCreateBrand(name)} createLabel="Create" invalid={!!errors.brandId} />
        </Field>
        <Field label="Category" htmlFor={`${uid}-cat`} error={errors.categoryId}>
          <Select id={`${uid}-cat`} value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })} invalid={!!errors.categoryId}><option value="">Choose a category</option>{categories.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </Field>
        <Field label="Base SKU" htmlFor={`${uid}-sku`} error={errors.baseSku} help={<span className="tabular">Variant SKUs: {variantSku(form.baseSku.trim(), firstSize, firstColor)}</span>}>
          <Input id={`${uid}-sku`} value={form.baseSku} onChange={(e) => set({ baseSku: e.target.value.toUpperCase() })} placeholder="Auto from brand + name" invalid={!!errors.baseSku} className="tabular" autoComplete="off" />
        </Field>
      </div>
      <Field label="Description" htmlFor={`${uid}-desc`}><Textarea id={`${uid}-desc`} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Fabric, fit, care — what a seller needs to know." /></Field>
      <Field label="Tags" htmlFor={`${uid}-tags`} help="Press Enter or comma to add.">
        <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-input border border-line bg-surface px-2 py-1.5 focus-within:border-accent">
          {form.tags.map((t) => <Chip key={t} size="sm" onRemove={() => set({ tags: form.tags.filter((x) => x !== t) })}>{t}</Chip>)}
          <input id={`${uid}-tags`} value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } if (e.key === 'Backspace' && !tag && form.tags.length) set({ tags: form.tags.slice(0, -1) }); }} onBlur={addTag} placeholder={form.tags.length ? 'Add tag…' : 'e.g. linen, summer'} className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3" />
        </div>
      </Field>
    </>
  );
}

/* ---------- 2 · Images ---------- */
export function ImagesSection({ form, set, tint }: Pick<SectionProps, 'form' | 'set'> & { tint?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  // POST /uploads (≤ 4 MB, jpeg/png/webp); the mock keeps a local object URL instead.
  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setUploadError(undefined);
    const accepted = Array.from(files).filter((f) => f.type.startsWith('image/') && f.size <= 4 * 1024 * 1024);
    if (accepted.length < files.length) setUploadError('Only JPG, PNG or WebP up to 4 MB are accepted.');
    const urls: string[] = [];
    for (const f of accepted) {
      try { urls.push((await api.uploads.image(f)).url); }
      catch (e) {
        const m = (e as Error).message;
        setUploadError(/storage not configured/i.test(m) ? 'Image uploads are not configured on this server (missing BLOB_READ_WRITE_TOKEN). Add the token and try again.' : m);
      }
    }
    if (urls.length) set({ images: [...form.images, ...urls] });
  };
  const remove = (i: number) => set({ images: form.images.filter((_, j) => j !== i) });
  const makeCover = (i: number) => { const img = form.images[i]; if (img === undefined) return; set({ images: [img, ...form.images.filter((_, j) => j !== i)] }); };
  return (
    <>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {form.images.map((src, i) => (
          <div key={`${src}-${i}`} className="relative">
            <Thumb src={src} tint={tint} alt={`Image ${i + 1}`} size="xl" className="size-full aspect-square" />
            {i === 0 && <Badge tone="accent" className="absolute left-1.5 top-1.5">Cover</Badge>}
            <div className="absolute right-1 top-1 flex gap-1">
              {i !== 0 && <button type="button" aria-label="Make cover" onClick={() => makeCover(i)} className="rounded-md bg-surface/90 px-1.5 text-[11px] font-medium shadow-sm hover:bg-surface">Cover</button>}
              <button type="button" aria-label={`Remove image ${i + 1}`} onClick={() => remove(i)} className="flex size-6 items-center justify-center rounded-md bg-surface/90 shadow-sm hover:bg-surface"><X className="size-3.5" /></button>
            </div>
          </div>
        ))}
        <label onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void addFiles(e.dataTransfer.files); }}
          className={cn('flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-xs font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent', over ? 'border-accent bg-accent-soft text-accent' : 'border-line')}>
          <ImagePlus className="size-5" aria-hidden />Add or drop
          <input ref={inputRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      {uploadError && <p role="alert" className="text-xs text-danger-ink">{uploadError}</p>}
      <p className="text-xs text-ink-2">First image is the cover · JPG/PNG/WebP up to 4 MB · 1:1 recommended. Images upload as you add them.</p>
    </>
  );
}

/* ---------- 3 · Variants ---------- */
const CUSTOM_COLOR = '__custom__';
const CUSTOM_SIZE = '__custom_size__';
const PRESET_PREFIX = '__preset__:';

/**
 * A theme-aware dropdown picker. Replaces native <select> whose option list is rendered by the
 * OS/browser and is unreadable in dark mode. Groups are rendered as section headers.
 */
type PickerGroup = { label?: string; items: { value: string; label: ReactNode; keywords?: string }[] };
function PickerMenu({ placeholder, groups, onPick, disabled, invalid, 'aria-label': ariaLabel }: {
  placeholder: string; groups: PickerGroup[]; onPick: (value: string) => void;
  disabled?: boolean; invalid?: boolean; 'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex min-h-10 w-full items-center justify-between gap-2 rounded-input border bg-surface px-3 text-left text-sm text-ink',
          'hover:bg-surface-2 focus:border-accent focus:outline-none',
          invalid ? 'border-danger' : 'border-line',
          disabled && 'opacity-60'
        )}
      >
        <span className="truncate text-ink-2">{placeholder}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-2" aria-hidden />
      </button>
      {open && (
        <div
          ref={popRef}
          role="listbox"
          className="absolute left-0 right-0 top-full z-[60] mt-1.5 max-h-72 overflow-y-auto rounded-card border border-line bg-surface p-1.5 shadow-float"
        >
          {groups.every((g) => g.items.length === 0) ? (
            <div className="px-3 py-2 text-sm text-ink-2">No options</div>
          ) : (
            groups.map((g, gi) => g.items.length === 0 ? null : (
              <div key={gi} className={cn(gi > 0 && 'mt-1 border-t border-line pt-1')}>
                {g.label && <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">{g.label}</div>}
                {g.items.map((it) => (
                  <button
                    key={it.value}
                    type="button"
                    role="option"
                    onClick={() => { onPick(it.value); setOpen(false); }}
                    className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-ink hover:bg-surface-2"
                  >
                    {it.label}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function VariantsSection({ form, set, errors, settings, showBarcodes = false, footwear = false }: SectionProps & { settings: Settings | undefined; showBarcodes?: boolean; footwear?: boolean }) {
  const presets = settings?.sizePresets ?? [];
  const [customSize, setCustomSize] = useState<string | null>(null);
  const [colorName, setColorName] = useState('');
  const [colorHex, setColorHex] = useState('#8A5B3C');
  const sizeGroupList = sizeGroups(presets, form.sizes, { footwear });
  const sizeOptions = sizeGroupList.flatMap((g) => g.sizes);
  const addCustomSize = () => { const v = (customSize ?? '').trim(); if (v && !form.sizes.some((x) => x.toLowerCase() === v.toLowerCase())) set({ sizes: [...form.sizes, v] }); setCustomSize(null); };
  const colorOptions: ColorRef[] = colorChoices(settings?.colorPresets ?? [], form.colors);
  const sameName = (a: ColorRef, b: ColorRef) => a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
  const isPicked = (c: ColorRef) => form.colors.some((x) => sameName(x, c));
  const toggleSize = (s: string) => set({ sizes: form.sizes.includes(s) ? form.sizes.filter((x) => x !== s) : [...form.sizes, s] });
  const toggleColor = (c: ColorRef) => set({ colors: isPicked(c) ? form.colors.filter((x) => !sameName(x, c)) : [...form.colors, c] });
  const hexOk = /^#[0-9a-fA-F]{6}$/.test(colorHex);
  const addColor = () => {
    const n = colorName.trim();
    if (!n || !hexOk) return;
    // A typed name that matches a known colour reuses it, so "red" and "Red" never become two variants.
    const known = colorOptions.find((c) => sameName(c, { name: n, hex: colorHex }));
    if (!isPicked(known ?? { name: n, hex: colorHex })) set({ colors: [...form.colors, known ?? { name: n, hex: colorHex }] });
    setColorName('');
    setShowCustomColor(false);
  };
  const applyPreset = (name: string) => { const p = presets.find((x) => x.name === name); if (p) set({ sizes: [...new Set([...form.sizes, ...p.sizes])] }); };
  // keep matrix order stable: sizes in option order, colors in option order
  const orderedSizes = sizeOptions.filter((s) => form.sizes.includes(s));
  const orderedColors = colorOptions.filter(isPicked);
  const remainingColors = colorOptions.filter((c) => !isPicked(c));
  const [showCustomColor, setShowCustomColor] = useState(false);
  const setBarcode = (key: string, code: string) => set({ barcodes: { ...(form.barcodes ?? {}), [key]: code } });
  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <fieldset className="flex min-w-0 flex-col gap-2.5">
          <legend className="mb-2 text-[13px] font-medium">Sizes</legend>
          <PickerMenu
            aria-label="Add a size"
            placeholder="Add a size…"
            groups={[
              ...(presets.length ? [{ label: 'Add a whole run', items: presets.map((p) => ({ value: PRESET_PREFIX + p.name, label: <span><span className="font-medium">{p.name}</span>: <span className="text-ink-2">{p.sizes.join(', ')}</span></span> })) }] : []),
              ...sizeGroupList.map((g) => ({ label: g.name, items: g.sizes.filter((x) => !form.sizes.includes(x)).map((x) => ({ value: x, label: x })) })),
              { items: [{ value: CUSTOM_SIZE, label: <span className="text-accent">Custom size…</span> }] },
            ]}
            onPick={(v) => {
              if (v === CUSTOM_SIZE) { setCustomSize(''); return; }
              if (v.startsWith(PRESET_PREFIX)) { applyPreset(v.slice(PRESET_PREFIX.length)); return; }
              if (v) toggleSize(v);
            }}
          />
          {orderedSizes.length > 0 && (
            <div className="flex flex-wrap gap-2">{orderedSizes.map((x) => <Chip key={x} selected onRemove={() => toggleSize(x)} aria-label={`Remove size ${x}`}>{x}</Chip>)}</div>
          )}
          {customSize !== null && (
            <div className="flex min-w-0 items-center gap-2">
              <Input size="sm" autoFocus aria-label="Custom size" value={customSize} wrapperClassName="min-w-0 flex-1" placeholder="e.g. 5XL or 44.5" onChange={(e) => setCustomSize(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomSize(); } if (e.key === 'Escape') setCustomSize(null); }} />
              <Button size="sm" variant="primary" onClick={addCustomSize} disabled={!customSize.trim()}>Add size</Button>
            </div>
          )}
        </fieldset>
        <fieldset className="flex min-w-0 flex-col gap-2.5">
          <legend className="mb-2 text-[13px] font-medium">Colors</legend>
          <PickerMenu
            aria-label="Add a color"
            placeholder={remainingColors.length ? 'Add a color…' : 'All colors added'}
            disabled={remainingColors.length === 0}
            groups={[
              { items: remainingColors.map((c) => ({ value: c.name, label: <span className="flex items-center gap-2"><ColorSwatch hex={c.hex} name={c.name} />{c.name}</span> })) },
              { items: [{ value: CUSTOM_COLOR, label: <span className="text-accent">Custom color…</span> }] },
            ]}
            onPick={(v) => {
              if (v === CUSTOM_COLOR) { setShowCustomColor(true); return; }
              const c = colorOptions.find((x) => x.name === v);
              if (c) toggleColor(c);
            }}
          />
          {orderedColors.length > 0 && (
            <div className="flex flex-wrap gap-2">{orderedColors.map((c) => <Chip key={c.name} selected onRemove={() => toggleColor(c)} aria-label={`Remove ${c.name}`} leading={<ColorSwatch hex={c.hex} name={c.name} />}>{c.name}</Chip>)}</div>
          )}
          {showCustomColor && <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Input size="sm" aria-label="Custom color name" placeholder="Color name, e.g. Red" value={colorName} onChange={(e) => { const v = e.target.value; setColorName(v); const hex = hexFromColorName(v); if (hex) setColorHex(hex); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColor(); } }} wrapperClassName="min-w-0 basis-full" />
            {/* The swatch IS the picker: tapping it opens the phone's native colour picker. */}
            <label className="relative flex min-h-8 flex-1 cursor-pointer items-center gap-2 rounded-input border border-line bg-surface px-2.5 text-[13px] text-ink-2">
              <ColorSwatch hex={hexOk ? colorHex : '#FFFFFF'} />
              <span>Tap to change shade</span>
              <input type="color" aria-label="Pick the shade" value={hexOk ? colorHex : '#8A5B3C'} onChange={(e) => setColorHex(e.target.value.toUpperCase())} className="absolute inset-0 size-full cursor-pointer opacity-0" />
            </label>
            <Button size="sm" variant="primary" onClick={addColor} disabled={!colorName.trim() || !hexOk}>Add color</Button>
          </div>}
        </fieldset>
      </div>
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface-2/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium" aria-live="polite">Preview · {form.sizes.length} size{form.sizes.length === 1 ? '' : 's'} × {form.colors.length} color{form.colors.length === 1 ? '' : 's'} = {form.sizes.length * form.colors.length} variant{form.sizes.length * form.colors.length === 1 ? '' : 's'}</p>
          <Checkbox checked={form.setInitialQty} onChange={(v) => set({ setInitialQty: v })} label="Set initial quantity per cell" />
        </div>
        {errors.variants && <p className="text-xs text-danger-ink" role="alert">{errors.variants}</p>}
        {orderedSizes.length > 0 && orderedColors.length > 0 ? (
          form.setInitialQty
            ? <VariantMatrix sizes={orderedSizes} colors={orderedColors} variants={[]} editable={{ values: form.initialQty, onChange: (key, qty) => set({ initialQty: { ...form.initialQty, [key]: qty } }) }} cellHeight="sm" minCol={64} />
            : <div className="flex flex-wrap gap-1.5 text-xs text-ink-2">{orderedSizes.map((s) => <span key={s} className="tabular rounded-md bg-surface px-2 py-1">{s} × {orderedColors.length}</span>)}</div>
        ) : <p className="text-xs text-ink-2">Pick at least one size and one color to preview the variants.</p>}
      </div>
      {showBarcodes && orderedSizes.length > 0 && orderedColors.length > 0 && (
        <fieldset className="flex min-w-0 flex-col gap-3 rounded-card border border-line p-3">
          <legend className="px-1 text-[13px] font-medium">Barcodes <span className="font-normal text-ink-2">· optional, scan or type</span></legend>
          {orderedSizes.flatMap((s) => orderedColors.map((c) => {
            const key = `${s}|${c.name}`;
            return (
              <div key={key} className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="flex basis-full items-center gap-1.5 text-xs"><ColorSwatch hex={c.hex} name={c.name} />{s} · {c.name}</span>
                <Input size="sm" inputMode="numeric" aria-label={`Barcode for ${s} ${c.name}`} placeholder="Barcode" value={form.barcodes?.[key] ?? ''} onChange={(e) => setBarcode(key, e.target.value)} wrapperClassName="min-w-0 flex-1" className="tabular" />
                <BarcodeCaptureButton size="sm" label="Scan" aria-label={`Scan barcode for ${s} ${c.name}`} onCode={(code) => setBarcode(key, code)} />
              </div>
            );
          }))}
        </fieldset>
      )}
    </>
  );
}

/* ---------- 4 · Pricing ---------- */
export function PricingSection({ form, set, errors, derived }: SectionProps & { derived: Derived }) {
  const uid = useId();
  const setOverride = (key: string, patch: { cost?: number; price?: number }) => {
    const prev = form.overrides[key] ?? {};
    const next = { ...prev, ...patch };
    const overrides = { ...form.overrides };
    if (next.cost === undefined && next.price === undefined) delete overrides[key]; else overrides[key] = next;
    set({ overrides });
  };
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Default cost" htmlFor={`${uid}-cost`} error={errors.defaultCost}><MoneyInput id={`${uid}-cost`} value={form.defaultCost} onChange={(v) => set({ defaultCost: v })} placeholder="0.00" invalid={!!errors.defaultCost} /></Field>
        <Field label="Default price" htmlFor={`${uid}-price`} error={errors.defaultPrice}><MoneyInput id={`${uid}-price`} value={form.defaultPrice} onChange={(v) => set({ defaultPrice: v })} placeholder="0.00" invalid={!!errors.defaultPrice} /></Field>
        <KpiCard compact label="Live margin" value={derived.margin !== undefined ? formatPct(derived.margin) : '—'} sub={derived.perUnit !== undefined ? <span className={cn('tabular', derived.perUnit < 0 && 'text-danger-ink')}>· {formatMoney(derived.perUnit)} per unit{derived.perUnit < 0 ? ' · below cost' : ''}</span> : 'Enter cost and price'} />
      </div>
      {derived.cells.length > 0 && (
        <details className="group rounded-card border border-line">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium marker:text-ink-3">Override per variant{derived.overrideCount ? ` (${derived.overrideCount} override${derived.overrideCount === 1 ? '' : 's'})` : ''}</summary>
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2"><th className="px-4 py-2">Variant</th><th className="px-2 py-2">Cost</th><th className="px-2 py-2">Price</th><th className="px-4 py-2 text-right">Margin</th></tr></thead>
              <tbody>
                {derived.cells.map((cell) => {
                  const o = form.overrides[cell.key];
                  const cost = o?.cost ?? form.defaultCost;
                  const price = o?.price ?? form.defaultPrice ?? 0;
                  const m = marginPct(price, cost);
                  const below = cost !== undefined && price < cost;
                  return (
                    <tr key={cell.key} className="border-t border-line">
                      <td className="whitespace-nowrap px-4 py-1.5"><span className="flex items-center gap-2"><ColorSwatch hex={cell.color.hex} name={cell.color.name} />{cell.size} · {cell.color.name}</span></td>
                      <td className="px-2 py-1.5"><MoneyInput size="sm" aria-label={`${cell.size} ${cell.color.name} cost`} value={o?.cost} onChange={(v) => setOverride(cell.key, { cost: v })} placeholder={form.defaultCost !== undefined ? (form.defaultCost / 100).toFixed(2) : '—'} wrapperClassName="w-32" /></td>
                      <td className="px-2 py-1.5"><MoneyInput size="sm" aria-label={`${cell.size} ${cell.color.name} price`} value={o?.price} onChange={(v) => setOverride(cell.key, { price: v })} placeholder={form.defaultPrice !== undefined ? (form.defaultPrice / 100).toFixed(2) : '—'} wrapperClassName="w-32" invalid={below} /></td>
                      <td className={cn('tabular whitespace-nowrap px-4 py-1.5 text-right', below && 'font-medium text-danger-ink')}>{m !== undefined ? formatPct(m) : '—'}{below && ' · below cost'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

/* ---------- 5 · Review ---------- */
export function ReviewRail({ checks, derived, isEdit, onSave, onDraft, saving, draftLabel, onJump }: { checks: SectionCheck[]; derived: Derived; isEdit: boolean; onSave: () => void; onDraft: () => void; saving: boolean; draftLabel?: string; onJump?: (key: SectionCheck['key']) => void }) {
  const allOk = checks.every((c) => c.ok);
  return (
    <aside aria-labelledby="s-review" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:p-5">
      <h2 id="s-review" className="text-[15px] font-semibold">5 · Review</h2>
      <ol className="flex flex-col gap-2 text-sm">
        {checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2">
            {c.ok ? <Check className="mt-0.5 size-4 shrink-0 text-ok-ink" aria-label="OK" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger-ink" aria-label="Needs attention" />}
            <span className="min-w-0 flex-1">
              {onJump ? <button type="button" onClick={() => onJump(c.key)} className="text-left hover:underline">{c.label}</button> : c.label}
              {c.detail && <span className={cn('block text-xs', c.ok ? 'text-ink-2' : 'text-danger-ink')}>{c.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className="h-px bg-line" />
      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-ink-2">Stock value (cost)</dt><dd className="tabular font-medium">{formatMoney(derived.stockCost)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-ink-2">Stock value (retail)</dt><dd className="tabular font-medium">{formatMoney(derived.stockRetail)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-ink-2">Status</dt><dd><Badge tone="ok" dot>Active</Badge></dd></div>
      </dl>
      <Button variant="primary" size="lg" block loading={saving} disabled={!allOk} onClick={onSave}>{isEdit ? 'Save changes' : 'Save product'}</Button>
      {!isEdit && <Button block onClick={onDraft}>Save as draft</Button>}
      {draftLabel && <p className="text-center text-xs text-ink-2">{draftLabel}</p>}
      <p className="text-xs text-ink-2">{isEdit ? 'Saving updates name, brand, category, SKU, description, tags and default prices. New sizes or colors create variants at quantity 0.' : `Saving creates ${derived.variantCount} variant${derived.variantCount === 1 ? '' : 's'}${derived.units > 0 ? ` and an INITIAL movement of ${derived.units} units` : ''}.`}</p>
    </aside>
  );
}
