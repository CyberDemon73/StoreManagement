'use client';
/** Catalog · Categories list. Calls: GET /categories · POST /categories · PATCH /categories/:id (rename, archive, restore). */
import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { MenuItem, Popover } from '@/components/ui/Overlay';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import type { Category } from '@/types';
import { RenameForm } from './BrandsList';

export function CategoriesList({ className }: { className?: string }) {
  const list = useApi(() => api.catalog.categories(), []);
  const { toast } = useToast();
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (input: Partial<Category> & { name: string }, done: string) => {
    setBusy(true);
    try {
      const saved = await api.catalog.saveCategory(input);
      list.setData((prev) => (prev ? (input.id ? prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)) : [...prev, saved]) : [saved]));
      toast({ kind: 'success', title: done });
      return true;
    } catch (e) {
      toast({ kind: 'error', title: "Couldn't save category", body: e instanceof ApiError ? e.message : undefined });
      return false;
    } finally { setBusy(false); }
  };

  const rows = list.data ? [...list.data].sort((a, b) => Number(b.isActive) - Number(a.isActive)) : undefined;
  return (
    <Card padded={false} className={cn('flex flex-col overflow-hidden', className)} as="section" aria-labelledby="c-cats">
      <CardHeader id="c-cats" className="border-b border-line px-4 py-3" title="Categories" description={rows ? `${rows.filter((c) => c.isActive).length} active` : undefined} />
      {list.error && !rows ? <ErrorState compact error={list.error} onRetry={() => void list.refetch()} /> : !rows ? <SkeletonRows rows={6} className="px-4" /> : rows.length === 0 ? <EmptyState compact title="No categories yet" body="Add one below to start grouping products." /> : (
        <ul className="flex flex-col">
          {rows.map((c) => (
            <li key={c.id} className={cn('flex min-h-11 items-center gap-3 border-b border-line px-4 py-1.5 last:border-0', renaming === c.id && 'bg-accent-soft/60', !c.isActive && 'opacity-60')}>
              {renaming === c.id ? (
                <RenameForm initial={c.name} busy={busy} label="Rename category" onCancel={() => setRenaming(null)} onSave={async (name) => { if (await save({ id: c.id, name }, 'Category renamed')) setRenaming(null); }} />
              ) : (
                <>
                  <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', !c.isActive && 'line-through')}>{c.name}</span>
                  {c.isActive ? <span className="tabular text-xs text-ink-2">{c.productCount ?? 0}</span> : <Badge>Archived · {c.productCount ?? 0}</Badge>}
                  {c.isActive ? (
                    <Popover open={menu === c.id} onClose={() => setMenu(null)} anchor={<Button size="sm" variant="ghost" iconOnly aria-label={`Actions for ${c.name}`} aria-haspopup="menu" aria-expanded={menu === c.id} onClick={() => setMenu(menu === c.id ? null : c.id)}><MoreHorizontal /></Button>}>
                      <MenuItem onClick={() => { setMenu(null); setRenaming(c.id); }}>Rename</MenuItem>
                      <MenuItem href={`/products?categoryId=${c.id}`}>View products</MenuItem>
                      <div className="my-1 h-px bg-line" />
                      <MenuItem danger onClick={() => { setMenu(null); void save({ id: c.id, name: c.name, isActive: false }, `${c.name} archived`); }}>Archive</MenuItem>
                    </Popover>
                  ) : (
                    <Button size="sm" variant="ghost" loading={busy} onClick={() => void save({ id: c.id, name: c.name, isActive: true }, `${c.name} restored`)}>Restore</Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="border-t border-line px-4 py-3" onSubmit={async (e) => { e.preventDefault(); const n = newName.trim(); if (!n) return; if (await save({ name: n }, `Category "${n}" added`)) setNewName(''); }}>
        <Input size="md" aria-label="New category" placeholder="New category name…" value={newName} onChange={(e) => setNewName(e.target.value)} trailing={<Button size="sm" type="submit" loading={busy} disabled={!newName.trim()}>Add</Button>} />
      </form>
    </Card>
  );
}
