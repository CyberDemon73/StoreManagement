'use client';
/**
 * Screen: /audit · Roles: ADMIN, MANAGER (audit.read)
 * Calls: GET /audit?q&userId&entity&from&to&page&pageSize · GET /users (user chip menu).
 * Rows expand to Before / After JSON with changed keys highlighted. Mobile renders cards.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, ScrollText } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/api';
import { useApi, useBreakpoint, useDebounced } from '@/lib/use-api';
import { useDateRange } from '@/lib/use-date-range';
import { cn } from '@/lib/cn';
import { formatDate, formatTime } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { Avatar, Badge, Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateRangePicker, SearchInput } from '@/components/ui/Controls';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MenuItem, Popover } from '@/components/ui/Overlay';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import type { AuditEntry } from '@/types';
import { csvDataUrl, downloadUrl } from '@/screens/analytics/tabs/shared';
import { actionTone, AuditDetails } from './AuditDetails';

const ENTITIES = ['Sale', 'Variant', 'Product', 'Purchase', 'Stock count', 'Settings', 'User', 'Session'];

export function AuditScreen() {
  const bp = useBreakpoint();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [userId, setUserId] = useState<string>();
  const [entity, setEntity] = useState<string>();
  const [range, setRange] = useDateRange('30d');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [menu, setMenu] = useState<'user' | 'entity' | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const users = useApi(() => api.users.list(), []);
  const list = useApi(() => api.audit.list({ q: dq || undefined, userId, entity, from: range.from, to: range.to, page, pageSize }), [dq, userId, entity, range.from, range.to, page, pageSize]);
  const rows = list.data?.data;
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const userName = users.data?.find((u) => u.id === userId)?.name.split(' ')[0];

  const exportCsv = () => {
    if (!rows) return;
    downloadUrl(csvDataUrl([['time', 'user', 'action', 'entity', 'label', 'summary', 'ip', 'requestId'], ...rows.map((a) => [a.createdAt, a.userName, a.action, a.entity, a.entityLabel, a.summary, a.ip ?? '', a.requestId ?? ''])]), `audit-${range.from}-${range.to}.csv`);
    toast({ kind: 'success', title: 'Audit log exported', body: `${rows.length} events on this page.` });
  };

  const columns: Column<AuditEntry>[] = [
    { key: 'expand', header: '', width: '32px', cell: (a) => <Button size="sm" variant="ghost" iconOnly aria-label={expanded.has(a.id) ? 'Collapse' : 'Expand'} aria-expanded={expanded.has(a.id)} onClick={(e) => { e.stopPropagation(); toggle(a.id); }}>{expanded.has(a.id) ? <ChevronDown /> : <ChevronRight />}</Button> },
    { key: 'time', header: 'Time', cell: (a) => <span className="tabular whitespace-nowrap text-xs text-ink-2">{formatDate(a.createdAt)} {formatTime(a.createdAt)}</span> },
    { key: 'user', header: 'User', cell: (a) => <span className="flex items-center gap-2"><Avatar name={a.userName} size="xs" />{a.userName.split(' ')[0]}</span> },
    { key: 'action', header: 'Action', cell: (a) => <Badge tone={actionTone(a.action)}>{a.action}</Badge> },
    { key: 'entity', header: 'Entity', cell: (a) => <span className="text-sm"><span className="text-ink-2">{a.entity}</span>{a.entityLabel && a.entityLabel !== a.entity && <> <span className="tabular">{a.entityLabel}</span></>}</span> },
    { key: 'summary', header: 'Summary', cell: (a) => <span className="text-sm">{a.summary}</span> },
  ];

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search summary, entity id…" aria-label="Search audit log" className="w-full md:w-80" />
      <Popover open={menu === 'user'} onClose={() => setMenu(null)} align="start" anchor={<Chip selected={!!userId} onClick={() => setMenu(menu === 'user' ? null : 'user')} aria-label="Filter by user">User: {userName ?? 'All'}<ChevronDown className="size-3.5 opacity-60" aria-hidden /></Chip>}>
        <MenuItem selected={!userId} onClick={() => { setUserId(undefined); setPage(1); setMenu(null); }}>All users</MenuItem>
        {(users.data ?? []).map((u) => <MenuItem key={u.id} selected={userId === u.id} onClick={() => { setUserId(u.id); setPage(1); setMenu(null); }}><Avatar name={u.name} size="xs" />{u.name}</MenuItem>)}
      </Popover>
      <Popover open={menu === 'entity'} onClose={() => setMenu(null)} align="start" anchor={<Chip selected={!!entity} onClick={() => setMenu(menu === 'entity' ? null : 'entity')} aria-label="Filter by entity">Entity: {entity ?? 'All'}<ChevronDown className="size-3.5 opacity-60" aria-hidden /></Chip>}>
        <MenuItem selected={!entity} onClick={() => { setEntity(undefined); setPage(1); setMenu(null); }}>All entities</MenuItem>
        {ENTITIES.map((e) => <MenuItem key={e} selected={entity === e} onClick={() => { setEntity(e); setPage(1); setMenu(null); }}>{e}</MenuItem>)}
      </Popover>
      <DateRangePicker compact value={range} onChange={(r) => { setRange(r); setPage(1); }} />
    </div>
  );

  const empty = <EmptyState icon={<ScrollText aria-hidden />} title="No events match" body={`Nothing recorded for ${[q && `“${q}”`, userName && `User: ${userName}`, entity && `Entity: ${entity}`, range.label].filter(Boolean).join(' · ')}.`} action={<Button onClick={() => { setQ(''); setUserId(undefined); setEntity(undefined); setPage(1); }}>Clear filters</Button>} />;
  const total = list.data?.total ?? 0;
  const pager = { page, pageSize, total, onPage: setPage, onPageSize: (n: number) => { setPageSize(n); setPage(1); } };

  return (
    <>
      <PageHeader title="Audit log" description="Every change, who made it and from where · retained 2 years" actions={<Button leading={<Download />} onClick={exportCsv} disabled={!rows?.length}>Export CSV</Button>} />
      <Page>
        {filters}
        {bp === 'mobile' ? (
          list.error && !rows ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !rows ? <SkeletonRows rows={8} /> : rows.length === 0 ? empty : (
            <>
              <ul className="flex flex-col gap-2">
                {rows.map((a) => (
                  <Card key={a.id} as="article" padded={false} className="overflow-hidden">
                    <button type="button" aria-expanded={expanded.has(a.id)} onClick={() => toggle(a.id)} className="flex w-full items-start gap-3 p-3.5 text-left">
                      <Avatar name={a.userName} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5"><Badge tone={actionTone(a.action)}>{a.action}</Badge><span className="tabular text-xs text-ink-2">{formatDate(a.createdAt)} {formatTime(a.createdAt)}</span></span>
                        <span className="mt-1 block text-sm">{a.summary}</span>
                        <span className="block text-xs text-ink-2">{a.userName.split(' ')[0]} · {a.entity}{a.entityLabel !== a.entity ? ` ${a.entityLabel}` : ''}</span>
                      </span>
                      {expanded.has(a.id) ? <ChevronDown className="size-4 shrink-0 text-ink-2" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-ink-2" aria-hidden />}
                    </button>
                    {expanded.has(a.id) && <div className="border-t border-line bg-surface-2 p-3.5"><AuditDetails entry={a} /></div>}
                  </Card>
                ))}
              </ul>
              <div className="flex items-center justify-between text-sm"><span className="tabular text-ink-2">{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}</span><div className="flex gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>Next</Button></div></div>
            </>
          )
        ) : (
          <ExpandableTable rows={rows} columns={columns} expanded={expanded} list={list} empty={empty} pager={pager} />
        )}
      </Page>
    </>
  );
}

/** DataTable cannot render a second row per entry, so the expanded details are rendered as a plain table beneath each matching row. */
function ExpandableTable({ rows, columns, expanded, list, empty, pager }: { rows: AuditEntry[] | undefined; columns: Column<AuditEntry>[]; expanded: Set<string>; list: { loading: boolean; error?: ApiError; refetch: () => Promise<void> }; empty: React.ReactNode; pager: NonNullable<React.ComponentProps<typeof DataTable<AuditEntry>>['page']> }) {
  if (!rows || (list.error && !rows) || rows.length === 0 || expanded.size === 0) {
    return <DataTable aria-label="Audit log" columns={columns} rows={rows} rowKey={(a) => a.id} loading={list.loading} error={list.error} onRetry={() => void list.refetch()} empty={empty} page={pager} footer={<span className="text-ink-2">Retained 2 years</span>} />;
  }
  // Split the page into runs so each expanded entry gets its details block directly under its row.
  const runs: { rows: AuditEntry[]; detail?: AuditEntry }[] = [];
  let current: AuditEntry[] = [];
  for (const a of rows) { current.push(a); if (expanded.has(a.id)) { runs.push({ rows: current, detail: a }); current = []; } }
  if (current.length) runs.push({ rows: current });
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
      {runs.map((r, i) => (
        <div key={r.detail?.id ?? `tail-${i}`} className={cn(i > 0 && 'border-t border-line')}>
          <DataTable aria-label={i === 0 ? 'Audit log' : undefined} className="rounded-none border-0" columns={columns} rows={r.rows} rowKey={(a) => a.id} rowClassName={(a) => (expanded.has(a.id) ? 'bg-surface-2/60' : undefined)} page={i === runs.length - 1 && !r.detail ? pager : undefined} />
          {r.detail && <div className="border-t border-line bg-surface-2 px-4 py-3 pl-14"><AuditDetails entry={r.detail} /></div>}
          {r.detail && i === runs.length - 1 && <div className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-sm"><span className="tabular text-ink-2">{(pager.page - 1) * pager.pageSize + 1}–{Math.min(pager.total, pager.page * pager.pageSize)} of {pager.total}</span><div className="ml-auto flex gap-2"><Button size="sm" disabled={pager.page <= 1} onClick={() => pager.onPage(pager.page - 1)}>Previous</Button><Button size="sm" disabled={pager.page * pager.pageSize >= pager.total} onClick={() => pager.onPage(pager.page + 1)}>Next</Button></div></div>}
        </div>
      ))}
    </div>
  );
}
