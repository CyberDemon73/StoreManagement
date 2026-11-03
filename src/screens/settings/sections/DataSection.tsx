'use client';
import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { csvDataUrl, downloadUrl } from '@/screens/analytics/tabs/shared';

type Preview = Awaited<ReturnType<typeof api.settings.importPreview>>;
const COLS = ['name', 'brand', 'category', 'size', 'color', 'colorHex', 'price', 'cost', 'qty', 'barcode'] as const;
// Category is the full path from the server, e.g. "Men/Shirts"; a unique leaf name still works
// on import, but the full path is the safe form that round-trips with an export.
const TEMPLATE = [
  [...COLS],
  ['Linen Shirt Relaxed', 'Northline', 'Men/Shirts', 'M', 'Black', '#1F2421', '890.00', '420.00', '12', ''],
  ['Chino Slim', 'Northline', 'Men/Trousers', '32', 'Sand', '#C8B89A', '1090.00', '510.00', '4', ''],
];

export function DataSection() {
  const auth = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);

  const exportAll = async () => {
    setExporting(true);
    try { downloadUrl(await api.products.exportCsv(), 'avenue-products.csv'); toast({ kind: 'success', title: 'Export ready', body: 'avenue-products.csv downloaded.' }); }
    catch (e) { toast({ kind: 'error', title: "Couldn't export", body: (e as Error).message }); }
    finally { setExporting(false); }
  };

  const loadPreview = async (f: File) => {
    setFile(f); setPreview(null); setPreviewError(null); setLoadingPreview(true);
    try { setPreview(await api.settings.importPreview(f)); }
    catch (e) { setPreviewError(e instanceof ApiError ? e : new ApiError('INTERNAL', (e as Error).message, 500)); }
    finally { setLoadingPreview(false); }
  };

  const doImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.settings.importCommit(file);
      toast({ kind: 'success', title: `${result.created.products} products imported`, body: result.errors.length ? `${result.errors.length} rows skipped.` : `${result.created.variants} variants created.` });
      setPreview(null); setFile(null);
    } catch (e) {
      // 400 means nothing was written; the server returns the same {rows, ok, errors} shape so the user can fix and retry.
      if (e instanceof ApiError && 'rows' in (e as unknown as Record<string, unknown>)) {
        toast({ kind: 'error', title: 'Nothing was imported', body: `${e.message}. The whole file was rejected.` });
      } else {
        toast({ kind: 'error', title: 'Nothing was imported', body: (e as Error).message });
      }
    } finally { setImporting(false); }
  };

  return (
    <Card as="section" id="s-data" className="flex flex-col gap-3 xl:col-span-2" aria-labelledby="s-data-h">
      <CardHeader id="s-data-h" title="Data" />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Button className="justify-start" leading={<Download />} loading={exporting} onClick={() => void exportAll()} disabled={!auth.can('data.export.all')} title={auth.can('data.export.all') ? undefined : 'Admins only'}>Export all data (CSV)</Button>
          {!auth.can('data.export.all') && <p className="text-xs text-ink-2">Full export is for admins.</p>}
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Import products CSV" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadPreview(f); e.target.value = ''; }} />
          <Button className="justify-start" leading={<Upload />} onClick={() => fileRef.current?.click()} loading={loadingPreview}>Import products CSV</Button>
          <a href={csvDataUrl(TEMPLATE)} download="template.csv" className="text-sm text-accent">Download template.csv</a>
        </div>
        <div className="xl:col-span-2">
          {previewError ? <ErrorState compact error={previewError} onRetry={() => file && void loadPreview(file)} /> : loadingPreview ? <div className="skeleton h-40 rounded-card" aria-busy /> : preview && file ? (
            <Card padded={false} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
                <p className="text-sm font-semibold">Import preview · {file.name}</p>
                <Badge tone="ok">{preview.ok} ok</Badge>
                {preview.errors.length > 0 && <Badge tone="danger">{preview.errors.length} error{preview.errors.length === 1 ? '' : 's'}</Badge>}
                <Button size="sm" variant="primary" className="ml-auto" loading={importing} disabled={preview.ok === 0} onClick={() => void doImport()}>Import {preview.ok} rows</Button>
              </div>
              {preview.errors.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-[11px] uppercase tracking-[0.06em] text-ink-2">{['#', ...COLS, 'Status'].map((h) => <th key={h} className={cn('border-b border-line px-3 py-2 font-semibold', (h === 'price' || h === 'qty') && 'text-right')}>{h}</th>)}</tr></thead>
                    <tbody>
                      {preview.errors.map((e) => (
                        <tr key={e.row} className="bg-danger-soft/60">
                          <td className="tabular border-b border-line px-3 py-2 text-ink-2">{e.row}</td>
                          {COLS.map((c) => <td key={c} className={cn('border-b border-line px-3 py-2', (c === 'price' || c === 'qty') && 'tabular text-right', e.message.toLowerCase().includes(c) && 'font-semibold text-danger-ink')}>{e.data[c] ?? ''}</td>)}
                          <td className="border-b border-line px-3 py-2"><Badge tone="danger">{e.message}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-3.5 py-2 text-xs text-ink-2">Fix the rows in your file and re-upload, or import the {preview.ok} valid rows now.</p>
                </div>
              ) : <p className="px-3.5 py-3 text-sm text-ink-2">All {preview.rows} rows look good.</p>}
            </Card>
          ) : (
            <div className="flex h-full min-h-[120px] items-center justify-center rounded-card border border-dashed border-line p-4 text-center text-sm text-ink-2">Choose a CSV to preview it here before anything is written.</div>
          )}
        </div>
      </div>
    </Card>
  );
}
