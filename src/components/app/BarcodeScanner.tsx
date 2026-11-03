'use client';
/**
 * BarcodeScannerButton — opens a camera sheet. The real implementation would use the
 * BarcodeDetector API / a WASM decoder; here the sheet lets you type or pick a sample code so
 * the scan → lookup flow is testable. Resolves with the variant from GET /variants/lookup.
 */
import { useState } from 'react';
import { Camera, ScanLine } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button, type ButtonProps } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Overlay';
import { Input } from '@/components/ui/Field';
import type { VariantWithProduct } from '@/types';

export function BarcodeScannerButton({ onScan, label = 'Scan', ...btn }: { onScan: (v: VariantWithProduct) => void; label?: string } & Omit<ButtonProps, 'onClick' | 'children'>) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (c: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const v = await api.variants.lookup(/^\d+$/.test(c) ? { barcode: c } : { sku: c });
      onScan(v);
      setOpen(false);
      setCode('');
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'NOT_FOUND' ? `No variant with code ${c}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button leading={<ScanLine />} onClick={() => setOpen(true)} {...btn}>{label}</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Scan barcode" description="Point the camera at the label, or type the code.">
        <div className="flex aspect-[4/3] items-center justify-center rounded-card bg-ink/90 text-bg">
          <div className="relative flex size-40 items-center justify-center rounded-lg border-2 border-dashed border-bg/60"><Camera className="size-8 opacity-70" aria-hidden /><span className="absolute inset-x-2 top-1/2 h-0.5 bg-danger/80" aria-hidden /></div>
        </div>
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void submit(code.trim()); }}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Barcode or SKU" inputMode="numeric" aria-label="Barcode" invalid={!!error} data-autofocus />
          <Button type="submit" variant="primary" loading={busy}>Find</Button>
        </form>
        {error && <p className="mt-2 text-xs text-danger-ink" role="alert">{error}</p>}
        <p className="mt-3 text-xs text-ink-2">Try a sample: <button type="button" className="tabular underline" onClick={() => void submit('NL-LSR-M-SAN')}>NL-LSR-M-SAN</button> · <button type="button" className="tabular underline" onClick={() => void submit('NL-CHS-32-BLA')}>NL-CHS-32-BLA</button></p>
      </Sheet>
    </>
  );
}
