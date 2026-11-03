'use client';
/**
 * Bulk actions for selected products on /products (managers only).
 * Calls: POST /products/:id/archive (per product) · PATCH /products/:id (categoryId) ·
 * GET /products/:id (to collect variant ids for the labels link).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Overlay';
import { Field, Select } from '@/components/ui/Field';
import type { Category } from '@/types';

export function ProductBulkBar({ selected, onClear, onDone, categories }: { selected: string[]; onClear: () => void; onDone: () => void; categories: Category[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [catId, setCatId] = useState('');
  const [busy, setBusy] = useState<'archive' | 'category' | 'labels' | null>(null);
  const n = selected.length;
  if (n === 0) return null;

  const runAll = async (label: string, fn: (id: string) => Promise<unknown>) => {
    let ok = 0;
    let failed = 0;
    for (const id of selected) {
      try { await fn(id); ok++; } catch { failed++; }
    }
    toast({ kind: failed ? 'error' : 'success', title: `${label} ${ok} product${ok === 1 ? '' : 's'}`, body: failed ? `${failed} failed. Nothing else was changed.` : undefined });
    onDone();
    onClear();
  };

  const archive = async () => {
    setBusy('archive');
    await runAll('Archived', (id) => api.products.archive(id, true));
    setBusy(null);
    setArchiveOpen(false);
  };

  const changeCategory = async () => {
    if (!catId) return;
    setBusy('category');
    await runAll('Moved', (id) => api.products.update(id, { categoryId: catId }));
    setBusy(null);
    setCatOpen(false);
  };

  const printLabels = async () => {
    setBusy('labels');
    try {
      const details = await Promise.all(selected.map((id) => api.products.get(id)));
      const ids = details.flatMap((d) => d.variants.map((v) => v.id));
      if (ids.length === 0) { toast({ kind: 'info', title: 'No variants to print', body: 'The selected products have no variants yet.' }); return; }
      router.push(`/labels?variantIds=${ids.join(',')}`);
    } catch (e) {
      toast({ kind: 'error', title: "Couldn't load variants", body: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 rounded-card border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
        <span className="font-semibold text-accent">{n} selected</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setArchiveOpen(true)}>Archive</Button>
          <Button size="sm" onClick={() => setCatOpen(true)}>Change category</Button>
          <Button size="sm" leading={<Printer />} loading={busy === 'labels'} onClick={() => void printLabels()}>Print labels</Button>
          <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
        </div>
      </div>
      <ConfirmDialog open={archiveOpen} onClose={() => setArchiveOpen(false)} onConfirm={() => void archive()} danger pending={busy === 'archive'} confirmLabel={`Archive ${n}`}
        title={`Archive ${n} product${n === 1 ? '' : 's'}?`} description="Archived products disappear from the POS and the default list. Stock and history are kept; you can restore them later." />
      <Dialog open={catOpen} onClose={() => setCatOpen(false)} title="Change category" description={`Moves ${n} product${n === 1 ? '' : 's'} to the chosen category.`}
        footer={<><Button onClick={() => setCatOpen(false)}>Cancel</Button><Button variant="primary" disabled={!catId} loading={busy === 'category'} onClick={() => void changeCategory()}>Move</Button></>}>
        <Field label="Category" htmlFor="bulk-cat"><Select id="bulk-cat" value={catId} onChange={(e) => setCatId(e.target.value)} data-autofocus><option value="">Choose a category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      </Dialog>
    </>
  );
}
