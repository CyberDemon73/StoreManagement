'use client';
/** Audit · expanded row: Before / After JSON side by side with changed keys marked, plus request metadata. */
import { Fragment } from 'react';
import type { Tone } from '@/components/ui/Badge';
import type { AuditAction, AuditEntry } from '@/types';

export function actionTone(action: AuditAction): Tone {
  if (action === 'sale.void') return 'danger';
  if (action === 'variant.adjust' || action === 'count.apply') return 'warn';
  if (action === 'settings.update') return 'info';
  if (action === 'purchase.post') return 'ok';
  if (action.startsWith('user.')) return 'accent';
  return 'neutral';
}

function changedKeys(before?: Record<string, unknown>, after?: Record<string, unknown>): Set<string> {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out = new Set<string>();
  for (const k of keys) if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) out.add(k);
  return out;
}

/** Pretty JSON where values of changed keys are wrapped in <mark>. */
function JsonBlock({ obj, changed, label }: { obj: Record<string, unknown> | undefined; changed: Set<string>; label: string }) {
  if (!obj) return <div><p className="eyebrow mb-1.5">{label}</p><p className="text-xs text-ink-2">—</p></div>;
  const entries = Object.entries(obj);
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5">{label}</p>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-surface p-2.5 font-mono text-xs leading-relaxed">
        {'{\n'}
        {entries.map(([k, v], i) => (
          <Fragment key={k}>
            {'  '}&quot;{k}&quot;: {changed.has(k) ? <mark className="rounded-sm bg-warn-soft px-0.5 text-warn-ink">{JSON.stringify(v)}</mark> : JSON.stringify(v)}{i < entries.length - 1 ? ',' : ''}{'\n'}
          </Fragment>
        ))}
        {'}'}
      </pre>
    </div>
  );
}

export function AuditDetails({ entry }: { entry: AuditEntry }) {
  const changed = changedKeys(entry.before, entry.after);
  const meta = [entry.ip && `IP ${entry.ip}`, entry.userAgent, entry.requestId && `request ${entry.requestId}`].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-2">
      {entry.before || entry.after ? (
        <div className="grid gap-3 md:grid-cols-2">
          <JsonBlock obj={entry.before} changed={changed} label="Before" />
          <JsonBlock obj={entry.after} changed={changed} label="After" />
        </div>
      ) : <p className="text-xs text-ink-2">No field changes recorded for this event.</p>}
      <p className="tabular text-xs text-ink-2">{meta || 'No request metadata recorded.'}{entry.entityId ? ` · ${entry.entity.toLowerCase()} ${entry.entityId}` : ''}</p>
    </div>
  );
}
