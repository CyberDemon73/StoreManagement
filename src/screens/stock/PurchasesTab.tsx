'use client';
/** "Purchases · n" tab of /stock/receive: GET /stock/purchases list + detail panel (GET /labels for line names). */
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useBreakpoint } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Panel } from '@/components/ui/Overlay';
import { ColorSwatch } from '@/components/ui/Badge';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import type { Purchase } from '@/types';

export function PurchasesTab() {
  const auth = useAuth();
  const bp = useBreakpoint();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState<Purchase>();
  const list = useApi(() => api.stock.purchases(page, pageSize), [page, pageSize]);
  const rows = list.data?.data;

  const columns: Column<Purchase>[] = [
    { key: 'number', header: 'Ref', cell: (p) => <span className="tabular font-semibold">{p.number}</span> },
    { key: 'supplier', header: 'Supplier', cell: (p) => p.supplierName ?? <span className="text-ink-2">—</span> },
    { key: 'invoice', header: 'Invoice', cell: (p) => <span className="tabular text-ink-2">{p.invoiceRef ?? '—'}</span> },
    { key: 'lines', header: 'Lines', align: 'right', cell: (p) => formatNumber(p.lineCount) },
    { key: 'units', header: 'Units', align: 'right', cell: (p) => formatNumber(p.unitCount) },
    { key: 'total', header: 'Total', align: 'right', when: auth.isManager, cell: (p) => <span className="font-semibold">{formatMoney(p.total)}</span> },
    { key: 'received', header: 'Received', cell: (p) => <span className="tabular text-xs text-ink-2">{formatDate(p.receivedAt)}</span> },
    { key: 'by', header: 'By', cell: (p) => <span className="text-ink-2">{p.createdByName.split(' ')[0]}</span> },
  ];
  const empty = <EmptyState compact title="No purchases yet" body="Post a purchase from the New purchase tab and it will appear here." />;

  return (
    <>
      {bp === 'mobile' ? (
        <div className="flex flex-col gap-2">
          {list.initial ? <SkeletonRows rows={6} /> : list.error && !rows ? <ErrorState error={list.error} onRetry={() => void list.refetch()} compact /> : rows && rows.length === 0 ? empty : rows?.map((p) => (
            <button key={p.id} type="button" onClick={() => setOpen(p)} className="flex min-h-11 items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left">
              <div className="min-w-0 flex-1"><p className="tabular text-sm font-semibold">{p.number}<span className="ml-2 font-normal text-ink-2">{p.supplierName ?? 'No supplier'}</span></p><p className="text-xs text-ink-2">{p.lineCount} lines · {p.unitCount} units · {formatDate(p.receivedAt)} · {p.createdByName.split(' ')[0]}</p></div>
              {auth.isManager && <span className="tabular text-sm font-semibold">{formatMoney(p.total)}</span>}
            </button>
          ))}
        </div>
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(p) => p.id} loading={list.loading} error={list.error} onRetry={() => void list.refetch()} empty={empty} onRowClick={setOpen} aria-label="Purchases"
          page={{ page, pageSize, total: list.data?.total ?? 0, onPage: setPage, onPageSize: (n) => { setPageSize(n); setPage(1); } }} />
      )}
      <PurchasePanel purchase={open} onClose={() => setOpen(undefined)} showCost={auth.isManager} />
    </>
  );
}

function PurchasePanel({ purchase, onClose, showCost }: { purchase: Purchase | undefined; onClose: () => void; showCost: boolean }) {
  const ids = purchase?.items.map((i) => i.variantId) ?? [];
  const variants = useApi(() => api.labels(ids), [purchase?.id], { enabled: !!purchase });
  const byId = new Map((variants.data ?? []).map((v) => [v.id, v]));
  return (
    <Panel open={!!purchase} onClose={onClose} title={purchase?.number} description={purchase ? `${purchase.supplierName ?? 'No supplier'}${purchase.invoiceRef ? ` · ${purchase.invoiceRef}` : ''} · ${formatDateTime(purchase.receivedAt)} · by ${purchase.createdByName}` : undefined}>
      {purchase && (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col divide-y divide-line">
            {purchase.items.map((it) => {
              const v = byId.get(it.variantId);
              return (
                <li key={it.variantId} className="flex items-center gap-3 py-2.5 text-sm">
                  {v ? <ColorSwatch hex={v.color.hex} name={v.color.name} /> : <span className="skeleton size-3.5 rounded-full" aria-hidden />}
                  <div className="min-w-0 flex-1">{v ? <><p className="truncate font-medium">{v.product.name} · {v.size} · {v.color.name}</p><p className="tabular text-xs text-ink-2">{v.sku}</p></> : <span className="skeleton block h-4 w-40" />}</div>
                  <span className="tabular text-ink-2">× {it.qty}</span>
                  {showCost && <span className="tabular w-24 text-right font-semibold">{formatMoney(it.qty * it.unitCost)}</span>}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3.5 py-3 text-sm">
            <div className="flex justify-between"><span className="text-ink-2">Lines</span><span className="tabular">{purchase.lineCount}</span></div>
            <div className="flex justify-between"><span className="text-ink-2">Units</span><span className="tabular">{purchase.unitCount}</span></div>
            {showCost && <div className="flex justify-between text-[15px] font-semibold"><span>Total</span><span className="tabular">{formatMoney(purchase.total, 'EGP', { withCurrency: true })}</span></div>}
          </div>
          {purchase.note && <p className="text-sm text-ink-2">{purchase.note}</p>}
        </div>
      )}
    </Panel>
  );
}
