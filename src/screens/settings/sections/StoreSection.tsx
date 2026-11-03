'use client';
import { useRef } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import type { SectionProps } from './shared';

export function StoreSection({ draft, patch }: SectionProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Card as="section" id="s-store" className="flex flex-col gap-3" aria-labelledby="s-store-h">
      <CardHeader id="s-store-h" title="Store" />
      <div className="flex items-center gap-3.5">
        <span aria-hidden className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-accent text-2xl font-bold text-accent-ink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {draft.logoUrl ? <img src={draft.logoUrl} alt="" className="size-full object-cover" /> : (draft.storeName[0] ?? 'A')}
        </span>
        <div className="flex flex-col gap-1.5">
          <input ref={fileRef} type="file" accept="image/png,image/svg+xml" className="sr-only" aria-label="Change logo" onChange={(e) => { const f = e.target.files?.[0]; if (f) patch({ logoUrl: URL.createObjectURL(f) }); e.target.value = ''; }} />
          <div className="flex gap-2"><Button size="sm" onClick={() => fileRef.current?.click()}>Change logo</Button>{draft.logoUrl && <Button size="sm" variant="ghost" onClick={() => patch({ logoUrl: undefined })}>Remove</Button>}</div>
          <p className="text-xs text-ink-2">PNG/SVG · square · used on receipts & PWA icon</p>
        </div>
      </div>
      <Field label="Store name" htmlFor="st-name"><Input id="st-name" value={draft.storeName} onChange={(e) => patch({ storeName: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone" htmlFor="st-phone"><Input id="st-phone" type="tel" inputMode="tel" value={draft.phone ?? ''} onChange={(e) => patch({ phone: e.target.value })} /></Field>
        <Field label="Address" htmlFor="st-addr"><Input id="st-addr" value={draft.address ?? ''} onChange={(e) => patch({ address: e.target.value })} /></Field>
      </div>
    </Card>
  );
}

const CURRENCIES = [['EGP', 'EGP — Egyptian pound (default)'], ['USD', 'USD — US dollar'], ['SAR', 'SAR — Saudi riyal'], ['AED', 'AED — UAE dirham']] as const;
const TIMEZONES = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London'];

export function LocalizationSection({ draft, patch }: SectionProps) {
  return (
    <Card as="section" id="s-loc" className="flex flex-col gap-3" aria-labelledby="s-loc-h">
      <CardHeader id="s-loc-h" title="Localization" />
      <Field label="Currency" htmlFor="lc-cur" help="All amounts are stored as integer minor units (piasters).">
        <Select id="lc-cur" value={draft.currency} onChange={(e) => patch({ currency: e.target.value })}>{CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Timezone" htmlFor="lc-tz"><Select id="lc-tz" value={draft.timezone} onChange={(e) => patch({ timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t} value={t}>{t}{t === 'Africa/Cairo' ? ' (default)' : ''}</option>)}</Select></Field>
        <Field label="Date format" htmlFor="lc-df"><Select id="lc-df" value={draft.dateFormat} onChange={(e) => patch({ dateFormat: e.target.value as 'DD/MM/YYYY' | 'YYYY-MM-DD' })}><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option></Select></Field>
      </div>
    </Card>
  );
}
