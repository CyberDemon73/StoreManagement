'use client';
/**
 * Screen: /settings?section= · Roles: ADMIN, MANAGER (settings.write)
 * Calls: GET /settings · PATCH /settings · POST /products/import?dryRun=1 · GET /products/export.
 * Left nav picks a section (sticky list on md+, Select on mobile); the form is one draft with
 * dirty tracking, saved from the header.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import type { Settings } from '@/types';
import { dirtyKeys, SECTION_KEYS, SECTION_LABEL, SECTIONS, type Section } from './sections/shared';
import { LocalizationSection, StoreSection } from './sections/StoreSection';
import { InventorySection } from './sections/InventorySection';
import { ReceiptSection, SalesSection } from './sections/SalesSection';
import { SecuritySection } from './sections/SecuritySection';
import { DataSection } from './sections/DataSection';
import { AppearanceSection } from './sections/AppearanceSection';

export function SettingsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const raw = params.get('section');
  const section: Section = (SECTIONS as readonly string[]).includes(raw ?? '') ? (raw as Section) : 'store';
  const setSection = (s: Section) => router.replace(`/settings?section=${s}`, { scroll: false });

  const saved = useApi(() => api.settings.get(), []);
  const [draft, setDraft] = useState<Settings>();
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (saved.data && !draft) setDraft(saved.data); }, [saved.data, draft]);

  const dirty = useMemo(() => (saved.data && draft ? dirtyKeys(saved.data, draft) : []), [saved.data, draft]);
  const dirtySections = SECTIONS.filter((s) => SECTION_KEYS[s].some((k) => dirty.includes(k)));
  const patch = (p: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...p } : d));

  useEffect(() => {
    if (!dirty.length) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty.length]);

  const save = async () => {
    if (!draft || !dirty.length) return;
    setSaving(true);
    try {
      const patchBody = Object.fromEntries(dirty.map((k) => [k, draft[k]])) as Partial<Settings>;
      const next = await api.settings.update(patchBody);
      saved.setData(next); setDraft(next);
      toast({ kind: 'success', title: 'Settings saved', body: dirtySections.map((s) => SECTION_LABEL[s]).join(', ') });
    } catch (e) {
      toast({ kind: 'error', title: "Couldn't save settings", body: e instanceof ApiError ? e.message : undefined });
    } finally { setSaving(false); }
  };

  const content = !draft ? (saved.error ? <ErrorState error={saved.error} onRetry={() => void saved.refetch()} /> : <div className="grid gap-4 xl:grid-cols-2" aria-busy><Skeleton className="h-64 rounded-card" /><Skeleton className="h-64 rounded-card" /></div>) : (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      {section === 'store' && <><StoreSection draft={draft} patch={patch} /><LocalizationSection draft={draft} patch={patch} /></>}
      {section === 'localization' && <><LocalizationSection draft={draft} patch={patch} /><StoreSection draft={draft} patch={patch} /></>}
      {section === 'inventory' && <InventorySection draft={draft} patch={patch} />}
      {section === 'sales' && <><SalesSection draft={draft} patch={patch} /><ReceiptSection draft={draft} patch={patch} /></>}
      {section === 'receipt' && <><ReceiptSection draft={draft} patch={patch} /><SalesSection draft={draft} patch={patch} /></>}
      {section === 'security' && <SecuritySection draft={draft} patch={patch} />}
      {section === 'data' && <DataSection />}
      {section === 'appearance' && <AppearanceSection />}
    </div>
  );

  return (
    <>
      <PageHeader wide title="Settings" compactTitle={SECTION_LABEL[section]} actions={<>
        {dirtySections.length > 0 && <span className="text-xs text-ink-2" role="status">Unsaved changes in {dirtySections.map((s) => SECTION_LABEL[s]).join(', ')}</span>}
        {dirty.length > 0 && <Button variant="ghost" onClick={() => setDraft(saved.data)} disabled={saving}>Discard</Button>}
        <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty.length}>Save changes</Button>
      </>} />
      <Page wide className="md:grid md:grid-cols-[220px_minmax(0,1fr)] md:items-start md:gap-6">
        <nav aria-label="Settings sections" className="md:sticky md:top-20">
          <div className="md:hidden"><Select aria-label="Section" value={section} onChange={(e) => setSection(e.target.value as Section)}>{SECTIONS.map((s) => <option key={s} value={s}>{SECTION_LABEL[s]}{dirtySections.includes(s) ? ' •' : ''}</option>)}</Select></div>
          <ul className="hidden flex-col gap-0.5 md:flex">
            {SECTIONS.map((s) => (
              <li key={s}><button type="button" aria-current={section === s ? 'page' : undefined} onClick={() => setSection(s)} className={cn('flex min-h-9 w-full items-center justify-between rounded-lg px-3 text-left text-sm transition-colors', section === s ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>{SECTION_LABEL[s]}{dirtySections.includes(s) && <span aria-label="unsaved" className="size-1.5 rounded-full bg-warn" />}</button></li>
            ))}
          </ul>
        </nav>
        <div className="mt-4 min-w-0 md:mt-0">{content}</div>
      </Page>
    </>
  );
}
