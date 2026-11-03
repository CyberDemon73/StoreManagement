'use client';
/**
 * Screen: /products/new · /products/[id]/edit · Roles: ADMIN, MANAGER (products.write)
 * Calls: GET /products/:id (edit) · GET /brands · GET /categories · GET /settings (presets) ·
 * POST /brands (create from combobox) · POST /products · PATCH /products/:id ·
 * POST /products/:id/variants (new sizes/colors on edit) · PATCH /variants/:id (per-variant overrides).
 * Layout: desktop single page with sections 1–4 and a sticky review rail; mobile 5-step stepper.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi, useBreakpoint, useLocalStorage } from '@/lib/use-api';
import { formatTime } from '@/lib/format';
import { matrixKey } from '@/components/app/VariantMatrix';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { Stepper } from '@/components/ui/Controls';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import type { ColorRef } from '@/types';
import { checklist, derive, DRAFT_KEY, type DraftRecord, EMPTY_FORM, type FormErrors, formFromProduct, type ProductFormState, STEPS, suggestBaseSku, validate } from './product-form';
import { useCatalog } from './products-shared';
import { BasicsSection, ImagesSection, PricingSection, ReviewRail, SectionCard, VariantsSection } from './ProductEditSections';

/** Only non-empty barcodes for cells that are still in the matrix. */
function cleanBarcodes(form: ProductFormState): Record<string, string> | undefined {
  const keys = new Set(form.sizes.flatMap((s) => form.colors.map((c) => `${s}|${c.name}`)));
  const out = Object.fromEntries(Object.entries(form.barcodes ?? {}).map(([k, v]): [string, string] => [k, v.trim()]).filter(([k, v]) => v !== '' && keys.has(k)));
  return Object.keys(out).length ? out : undefined;
}

export function ProductEditScreen({ id }: { id?: string }) {
  const isEdit = !!id;
  const router = useRouter();
  const bp = useBreakpoint();
  const { toast } = useToast();
  const catalog = useCatalog();
  const brandsApi = useApi(() => api.catalog.brands(), []);
  const brands = brandsApi.data ?? catalog.brands;
  const product = useApi(() => api.products.get(id ?? ''), [id], { enabled: isEdit });

  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useLocalStorage<DraftRecord | null>(DRAFT_KEY, null);
  const [draftOffered, setDraftOffered] = useState(false);
  const skuAuto = useRef(true);

  useEffect(() => { if (product.data) { setForm(formFromProduct(product.data)); skuAuto.current = false; } }, [product.data]);

  const set = useCallback((patch: Partial<ProductFormState>) => {
    setTouched(true);
    setServerErrors((e) => (patch.baseSku !== undefined ? { ...e, baseSku: undefined } : e));
    setForm((f) => {
      const next = { ...f, ...patch };
      if (!isEdit && skuAuto.current && (patch.name !== undefined || patch.brandId !== undefined)) next.baseSku = suggestBaseSku(brands.find((b) => b.id === next.brandId)?.name, next.name);
      if (patch.baseSku !== undefined) skuAuto.current = patch.baseSku === '';
      return next;
    });
  }, [isEdit, brands]);

  const errors = useMemo<FormErrors>(() => ({ ...validate(form), ...serverErrors }), [form, serverErrors]);
  const shownErrors: FormErrors = submitted || touched ? errors : {};
  const derived = useMemo(() => derive(form), [form]);
  const checks = useMemo(() => checklist(form, errors, derived), [form, errors, derived]);

  const createBrand = async (name: string) => {
    try { const b = await api.catalog.saveBrand({ name }); await brandsApi.refetch(); set({ brandId: b.id }); toast({ kind: 'success', title: `Brand “${b.name}” created` }); }
    catch (e) { toast({ kind: 'error', title: "Couldn't create the brand", body: (e as Error).message }); }
  };

  const saveDraft = () => { const rec = { form, savedAt: new Date().toISOString() }; setDraft(rec); toast({ kind: 'success', title: 'Draft saved', body: 'Stored on this device only.' }); };
  const restoreDraft = () => { if (draft) { setForm(draft.form); skuAuto.current = false; setTouched(true); } setDraftOffered(true); };

  const submit = async () => {
    setSubmitted(true);
    const v = validate(form);
    if (Object.keys(v).length || derived.variantCount === 0) {
      if (derived.variantCount === 0) setServerErrors((e) => ({ ...e, variants: 'Pick at least one size and one color' }));
      toast({ kind: 'error', title: 'Check the highlighted fields' });
      if (bp === 'mobile') setStep(v.name || v.brandId || v.categoryId || v.baseSku ? 0 : derived.variantCount === 0 ? 2 : 3);
      return;
    }
    setSaving(true);
    try {
      const base = { name: form.name.trim(), brandId: form.brandId, categoryId: form.categoryId, description: form.description.trim() || undefined, baseSku: form.baseSku.trim() || undefined, defaultCost: form.defaultCost, defaultPrice: form.defaultPrice ?? 0, tags: form.tags };
      const images = form.images.filter((u) => !u.startsWith('blob:'));
      let productId = id;
      if (isEdit && id && product.data) {
        await api.products.update(id, { ...base, images });
        const newSizes = form.sizes.filter((s) => !product.data!.sizes.includes(s));
        const newColors: ColorRef[] = form.colors.filter((c) => !product.data!.colors.some((x) => x.name === c.name));
        if (newSizes.length || newColors.length) await api.products.addVariants(id, { sizes: form.sizes, colors: form.colors });
      } else {
        const created = await api.products.create({ ...base, images, variants: { sizes: form.sizes, colors: form.colors, initialQty: form.setInitialQty ? form.initialQty : 0, barcodes: cleanBarcodes(form), costPrice: form.defaultCost, sellPrice: form.defaultPrice } });
        productId = created.id;
        await applyOverrides(created.variants);
      }
      if (isEdit && productId && derived.overrideCount > 0) { const fresh = await api.products.get(productId); await applyOverrides(fresh.variants); }
      if (!isEdit) setDraft(null);
      toast({ kind: 'success', title: isEdit ? 'Product saved' : `${form.name.trim()} created`, body: isEdit ? undefined : `${derived.variantCount} variants${derived.units ? ` · ${derived.units} units received` : ''}` });
      router.push(`/products/${productId}`);
    } catch (e) {
      if (e instanceof ApiError && e.fields) { setServerErrors(e.fields as FormErrors); if (bp === 'mobile' && e.fields.baseSku) setStep(0); }
      toast({ kind: 'error', title: isEdit ? "Couldn't save the product" : "Couldn't create the product", body: (e as Error).message });
    } finally { setSaving(false); }
  };

  /** Push per-variant cost/price overrides after the product exists. */
  const applyOverrides = async (variants: { id: string; size: string; color: ColorRef; costPrice?: number; sellPrice: number }[]) => {
    const jobs = Object.entries(form.overrides).flatMap(([key, o]) => {
      const v = variants.find((x) => matrixKey(x.size, x.color.name) === key);
      if (!v) return [];
      const patch: { costPrice?: number; sellPrice?: number } = {};
      if (o.cost !== undefined && o.cost !== v.costPrice) patch.costPrice = o.cost;
      if (o.price !== undefined && o.price !== v.sellPrice) patch.sellPrice = o.price;
      return Object.keys(patch).length ? [api.variants.update(v.id, patch)] : [];
    });
    if (jobs.length) await Promise.all(jobs);
  };

  const draftLabel = draft && !isEdit ? `Draft saved ${formatTime(draft.savedAt)}` : undefined;
  const title = isEdit ? (product.data?.name ?? 'Edit product') : 'New product';
  const tint = product.data?.tint ?? form.colors[0]?.hex;

  if (isEdit && product.error && !product.data) {
    return <><PageHeader title="Edit product" back="/products" crumbs={[{ label: 'Products', href: '/products' }]} /><Page><ErrorState error={product.error} onRetry={() => void product.refetch()} /></Page></>;
  }
  const loadingForm = isEdit && !product.data;

  /* ---------- mobile stepper ---------- */
  if (bp === 'mobile') {
    const last = step === STEPS.length - 1;
    const stepLabel = STEPS[step] ?? 'Basics';
    return (
      <>
        <PageHeader title={title} compactTitle={`${title} · ${step + 1}/${STEPS.length}`} back="/products" actions={!isEdit ? <Button size="sm" variant="ghost" onClick={saveDraft}>Save draft</Button> : undefined} />
        <Page className="pb-28">
          <p className="text-xs text-ink-2">Step {step + 1} of {STEPS.length} · {stepLabel}</p>
          <Stepper steps={[...STEPS]} current={step} onStep={setStep} />
          {!isEdit && draft && !draftOffered && <DraftBanner savedAt={draft.savedAt} onRestore={restoreDraft} onDiscard={() => { setDraft(null); setDraftOffered(true); }} />}
          {loadingForm ? <Skeleton className="h-64 rounded-card" /> : (
            <SectionCard id={`m-${step}`} title={`${step + 1} · ${stepLabel}`}>
              {step === 0 && <BasicsSection form={form} set={set} errors={shownErrors} brands={brands} categories={catalog.categories} onCreateBrand={createBrand} />}
              {step === 1 && <ImagesSection form={form} set={set} tint={tint} />}
              {step === 2 && <VariantsSection form={form} set={set} errors={shownErrors} settings={catalog.settings} showBarcodes={!isEdit} />}
              {step === 3 && <PricingSection form={form} set={set} errors={shownErrors} derived={derived} />}
              {step === 4 && <ReviewRail checks={checks} derived={derived} isEdit={isEdit} onSave={() => void submit()} onDraft={saveDraft} saving={saving} draftLabel={draftLabel} onJump={(k) => setStep(STEPS.indexOf(k))} />}
            </SectionCard>
          )}
        </Page>
        <footer className="no-print fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-line bg-surface px-4 pt-3 safe-bottom md:hidden">
          <Button size="lg" className="flex-1" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>
          {last ? <Button size="lg" variant="primary" className="flex-[2]" loading={saving} onClick={() => void submit()}>{isEdit ? 'Save changes' : 'Save product'}</Button>
            : <Button size="lg" variant="primary" className="flex-[2]" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>Next · {STEPS[step + 1]}</Button>}
        </footer>
      </>
    );
  }

  /* ---------- desktop / tablet ---------- */
  return (
    <>
      <PageHeader title={title} back="/products" crumbs={[{ label: 'Products', href: '/products' }, { label: isEdit ? 'Edit' : 'New product' }]}
        actions={<>
          {draftLabel && <span className="text-xs text-ink-2">{draftLabel}</span>}
          <LinkButton href={isEdit && id ? `/products/${id}` : '/products'}>Cancel</LinkButton>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>{isEdit ? 'Save changes' : 'Save product'}</Button>
        </>} />
      <Page wide>
        {!isEdit && draft && !draftOffered && <DraftBanner savedAt={draft.savedAt} onRestore={restoreDraft} onDiscard={() => { setDraft(null); setDraftOffered(true); }} />}
        {loadingForm ? <div className="grid gap-4 xl:grid-cols-[1fr_320px]"><div className="flex flex-col gap-4"><Skeleton className="h-64 rounded-card" /><Skeleton className="h-40 rounded-card" /></div><Skeleton className="h-80 rounded-card" /></div> : (
          <form id="product-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-4">
              <SectionCard id="s-basics" title="1 · Basics"><BasicsSection form={form} set={set} errors={shownErrors} brands={brands} categories={catalog.categories} onCreateBrand={createBrand} /></SectionCard>
              <SectionCard id="s-images" title="2 · Images"><ImagesSection form={form} set={set} tint={tint} /></SectionCard>
              <SectionCard id="s-variants" title="3 · Variants"><VariantsSection form={form} set={set} errors={shownErrors} settings={catalog.settings} showBarcodes={!isEdit} /></SectionCard>
              <SectionCard id="s-pricing" title="4 · Pricing"><PricingSection form={form} set={set} errors={shownErrors} derived={derived} /></SectionCard>
            </div>
            <div className="xl:sticky xl:top-20">
              <ReviewRail checks={checks} derived={derived} isEdit={isEdit} onSave={() => void submit()} onDraft={saveDraft} saving={saving} draftLabel={draftLabel} onJump={(k) => document.getElementById(`s-${k.toLowerCase()}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
            </div>
          </form>
        )}
      </Page>
    </>
  );
}

function DraftBanner({ savedAt, onRestore, onDiscard }: { savedAt: string; onRestore: () => void; onDiscard: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-info-soft px-3 py-2 text-sm text-info-ink">
      <span className="flex-1">You have an unsaved draft from {formatTime(savedAt)}.</span>
      <Button size="sm" onClick={onRestore}>Restore</Button>
      <Button size="sm" variant="ghost" onClick={onDiscard}>Discard</Button>
    </div>
  );
}
