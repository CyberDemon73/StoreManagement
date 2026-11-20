/**
 * The Edit save sequence, kept out of the component so it can be tested with a fake client.
 * Order matters: product fields, new cells, reactivations, quantities (ledger), barcodes, then
 * deletions/deactivations last so a refused delete never blocks the rest of the save.
 */
import { matrixKey } from '@/components/app/VariantMatrix';
import { ApiError, api } from '@/lib/api';
import type { ProductDetail } from '@/types';
import { derive, type EditPlan, type ProductFormState } from './product-form';

export type EditClient = Pick<typeof api, 'products' | 'variants' | 'stock'>;
export type ProductPatch = Parameters<typeof api.products.update>[1];

/** Only non-empty barcodes for cells that are still in the matrix. */
export function cleanBarcodes(form: ProductFormState): Record<string, string> | undefined {
  const keys = new Set(form.sizes.flatMap((s) => form.colors.map((c) => `${s}|${c.name}`)));
  const out = Object.fromEntries(Object.entries(form.barcodes ?? {}).map(([k, v]): [string, string] => [k, v.trim()]).filter(([k, v]) => v !== '' && keys.has(k)));
  return Object.keys(out).length ? out : undefined;
}

export interface SaveEditInput {
  productId: string;
  current: ProductDetail;
  form: ProductFormState;
  base: ProductPatch;
  images: string[];
  plan: EditPlan;
}

export async function saveProductEdits(client: EditClient, o: SaveEditInput): Promise<void> {
  const { productId, current, form, plan } = o;
  const derived = derive(form);

  await client.products.update(productId, { ...o.base, baseSku: form.baseSku.trim() || undefined, images: o.images });

  const have = new Map(current.variants.map((v) => [matrixKey(v.size, v.color.name), v] as const));
  const ids = new Map([...have].map(([key, v]) => [key, v.id] as const));
  const newCells = derived.cells.filter((c) => !have.has(c.key));
  if (newCells.length > 0) {
    // Only the new cells' barcodes: existing cells are changed through PATCH below, on Save.
    const newKeys = new Set(newCells.map((c) => c.key));
    const cleaned = cleanBarcodes(form);
    const barcodes = cleaned && Object.fromEntries(Object.entries(cleaned).filter(([k]) => newKeys.has(k)));
    const created = await client.products.addVariants(productId, {
      sizes: form.sizes,
      colors: form.colors,
      barcodes: barcodes && Object.keys(barcodes).length ? barcodes : undefined,
    });
    for (const v of created) ids.set(matrixKey(v.size, v.color.name), v.id);
  }

  for (const v of plan.reactivate) await client.variants.update(v.id, { isActive: true });

  const adjustments = derived.cells.flatMap((c) => {
    const variantId = ids.get(c.key);
    if (!variantId) return [];
    const now = have.get(c.key)?.quantity ?? 0;
    const next = form.initialQty[c.key] ?? now;
    return next === now ? [] : [{ variantId, newQty: next, reason: 'CORRECTION' as const, note: 'Set on product edit' }];
  });
  if (adjustments.length > 0) await client.stock.adjust(adjustments);

  await Promise.all(derived.cells.flatMap((c) => {
    const v = have.get(c.key);
    if (!v) return [];
    const next = form.barcodes?.[c.key]?.trim() || null;
    return next === (v.barcode ?? null) ? [] : [client.variants.update(v.id, { barcode: next })];
  }));

  for (const v of plan.remove) {
    try {
      await client.variants.remove(v.id);
    } catch (e) {
      // The ledger has history for this cell, so deletion is refused: hide it instead and keep the history.
      if (e instanceof ApiError && e.code === 'CONFLICT') await client.variants.update(v.id, { isActive: false });
      else throw e;
    }
  }
}
