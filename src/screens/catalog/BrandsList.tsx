'use client';
/** Catalog · Brands list. Calls: GET /brands · POST /brands · PATCH /brands/:id (rename, logo, archive). */
import { useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { MenuItem, Popover } from '@/components/ui/Overlay';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import type { Brand } from '@/types';

export function BrandsList({ className }: { className?: string }) {
  const list = useApi(() => api.catalog.brands(), []);
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoTarget = useRef<Brand | null>(null);

  const save = async (input: Partial<Brand> & { name: string }, done: string) => {
    setBusy(true);
    try {
      const saved = await api.catalog.saveBrand(input);
      list.setData((prev) => (prev ? (input.id ? prev.map((b) => (b.id === saved.id ? { ...b, ...saved } : b)) : [...prev, saved]) : [saved]));
      toast({ kind: 'success', title: done });
      return true;
    } catch (e) {
      toast({ kind: 'error', title: "Couldn't save brand", body: e instanceof ApiError ? e.message : undefined });
      return false;
    } finally { setBusy(false); }
  };

  const onLogo = async (file: File | undefined) => {
    const b = logoTarget.current;
    if (!file || !b) return;
    const url = URL.createObjectURL(file); // local preview; the real API uploads the file
    await save({ id: b.id, name: b.name, logoUrl: url }, `Logo updated for ${b.name}`);
  };

  const rows = list.data;
  return (
    <Card padded={false} className={cn('flex flex-col overflow-hidden', className)} as="section" aria-labelledby="c-brands">
      <CardHeader id="c-brands" className="border-b border-line px-4 py-3" title="Brands" description={rows ? `${rows.filter((b) => b.isActive).length} active` : undefined} action={<Button size="sm" variant="primary" leading={<Plus />} onClick={() => setAdding(true)}>New brand</Button>} />
      <input ref={fileRef} type="file" accept="image/png,image/svg+xml,image/jpeg" className="sr-only" aria-label="Upload brand logo" onChange={(e) => { void onLogo(e.target.files?.[0]); e.target.value = ''; }} />
      {list.error && !rows ? <ErrorState compact error={list.error} onRetry={() => void list.refetch()} /> : !rows ? <SkeletonRows rows={4} className="px-4" /> : (
        <ul className="flex flex-col">
          {adding && (
            <li className="flex items-center gap-3 border-b border-line bg-accent-soft/60 px-4 py-3">
              <form className="flex flex-1 items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (!newName.trim()) return; if (await save({ name: newName.trim() }, `Brand "${newName.trim()}" created`)) { setNewName(''); setAdding(false); } }}>
                <Input size="sm" autoFocus aria-label="New brand name" placeholder="Brand name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); setNewName(''); } }} />
                <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!newName.trim()}>Create</Button>
                <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(''); }}>Cancel</Button>
              </form>
            </li>
          )}
          {rows.length === 0 && !adding && <EmptyState compact title="No brands yet" body="Create the first brand to group your products." action={<Button size="sm" variant="primary" onClick={() => setAdding(true)}>New brand</Button>} />}
          {rows.map((b) => (
            <li key={b.id} className={cn('flex min-h-[60px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-0', renaming === b.id && 'bg-accent-soft/60', !b.isActive && 'opacity-60')}>
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink text-xs font-semibold text-bg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {b.logoUrl ? <img src={b.logoUrl} alt="" className="size-full object-cover" /> : initials(b.name)}
              </span>
              {renaming === b.id ? (
                <RenameForm initial={b.name} busy={busy} onCancel={() => setRenaming(null)} onSave={async (name) => { if (await save({ id: b.id, name }, 'Brand renamed')) setRenaming(null); }} />
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{b.name}</p>
                    <p className="text-xs text-ink-2">{b.productCount ?? 0} product{b.productCount === 1 ? '' : 's'} · {b.variantCount ?? 0} variant{b.variantCount === 1 ? '' : 's'}</p>
                  </div>
                  <Badge tone={b.isActive ? 'ok' : 'neutral'}>{b.isActive ? 'Active' : 'Archived'}</Badge>
                  <Popover open={menu === b.id} onClose={() => setMenu(null)} anchor={<Button size="sm" variant="ghost" iconOnly aria-label={`Actions for ${b.name}`} aria-haspopup="menu" aria-expanded={menu === b.id} onClick={() => setMenu(menu === b.id ? null : b.id)}><MoreHorizontal /></Button>}>
                    <MenuItem onClick={() => { setMenu(null); setRenaming(b.id); }}>Rename</MenuItem>
                    <MenuItem onClick={() => { setMenu(null); logoTarget.current = b; fileRef.current?.click(); }}>Upload logo</MenuItem>
                    <MenuItem href={`/products?brandId=${b.id}`}>View products</MenuItem>
                    <div className="my-1 h-px bg-line" />
                    {b.isActive
                      ? <MenuItem danger onClick={() => { setMenu(null); void save({ id: b.id, name: b.name, isActive: false }, `${b.name} archived`); }}>Archive</MenuItem>
                      : <MenuItem onClick={() => { setMenu(null); void save({ id: b.id, name: b.name, isActive: true }, `${b.name} restored`); }}>Restore</MenuItem>}
                  </Popover>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function RenameForm({ initial, busy, onSave, onCancel, label = 'Rename' }: { initial: string; busy?: boolean; onSave: (name: string) => void | Promise<void>; onCancel: () => void; label?: string }) {
  const [name, setName] = useState(initial);
  return (
    <form className="flex min-w-0 flex-1 flex-col gap-1" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name.trim() !== initial) void onSave(name.trim()); else onCancel(); }}>
      <div className="flex items-center gap-2">
        <Input size="sm" autoFocus aria-label={label} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} />
        <Button size="sm" variant="primary" type="submit" loading={busy}>Save</Button>
      </div>
      <p className="text-xs text-ink-2">Inline rename · Enter to save · Esc to cancel</p>
    </form>
  );
}
