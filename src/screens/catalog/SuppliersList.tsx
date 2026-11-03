'use client';
/** Catalog · Suppliers list. Calls: GET /suppliers · POST /suppliers · PATCH /suppliers/:id. */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import type { Supplier } from '@/types';

export function SuppliersList({ className }: { className?: string }) {
  const list = useApi(() => api.catalog.suppliers(), []);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError(undefined);
    try {
      const saved: Supplier = await api.catalog.saveSupplier({ name: form.name.trim(), phone: form.phone.trim() || undefined, notes: form.notes.trim() || undefined });
      list.setData((prev) => [...(prev ?? []), saved]);
      toast({ kind: 'success', title: `Supplier "${saved.name}" created` });
      setForm({ name: '', phone: '', notes: '' }); setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally { setBusy(false); }
  };

  const rows = list.data;
  return (
    <Card padded={false} className={cn('flex flex-col overflow-hidden', className)} as="section" aria-labelledby="c-sup">
      <CardHeader id="c-sup" className="border-b border-line px-4 py-3" title="Suppliers" description={rows ? `${rows.length} supplier${rows.length === 1 ? '' : 's'}` : undefined} action={<Button size="sm" variant="primary" leading={<Plus />} onClick={() => setOpen(true)}>New supplier</Button>} />
      {list.error && !rows ? <ErrorState compact error={list.error} onRetry={() => void list.refetch()} /> : !rows ? <SkeletonRows rows={4} className="px-4" /> : rows.length === 0 && !open ? <EmptyState compact title="No suppliers yet" body="Add the people you buy stock from to track purchases." action={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>New supplier</Button>} /> : (
        <ul className="flex flex-col">
          {rows.map((s) => (
            <li key={s.id} className={cn('flex flex-col gap-0.5 border-b border-line px-4 py-3 last:border-0', !s.isActive && 'opacity-60')}>
              <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-sm font-semibold">{s.name}</p><span className="tabular text-xs text-ink-2">{s.purchaseCount ?? 0} purchase{s.purchaseCount === 1 ? '' : 's'}</span></div>
              <p className="truncate text-xs text-ink-2">{[s.phone, s.notes, s.lastPurchaseAt ? `last PO ${formatDate(s.lastPurchaseAt)}` : undefined].filter(Boolean).join(' · ') || 'No details yet'}</p>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <form onSubmit={submit} className="m-4 flex flex-col gap-2.5 rounded-card border border-dashed border-line p-3.5" aria-label="New supplier">
          <p className="text-sm font-semibold">New supplier</p>
          <Field htmlFor="sup-name" error={error}><Input id="sup-name" autoFocus placeholder="Name" aria-label="Supplier name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!error} /></Field>
          <Input type="tel" inputMode="tel" placeholder="Phone" aria-label="Supplier phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Textarea placeholder="Notes (terms, contact person)" aria-label="Notes" className="min-h-14" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="flex justify-end gap-1.5"><Button size="sm" onClick={() => { setOpen(false); setError(undefined); }}>Cancel</Button><Button size="sm" variant="primary" type="submit" loading={busy}>Create</Button></div>
        </form>
      )}
    </Card>
  );
}
