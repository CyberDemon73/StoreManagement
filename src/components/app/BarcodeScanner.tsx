'use client';
/**
 * BarcodeScannerButton — opens a camera sheet and resolves a variant from a scanned or typed
 * code via GET /variants/lookup?barcode=|sku=.
 *
 * Decoding: the native BarcodeDetector API when the browser has it (Chrome/Edge/Android), else
 * ZXing (`@zxing/browser`) for Safari/Firefox. Frames come from getUserMedia with the rear camera.
 * Camera access needs a secure context: on a LAN device use `next dev --experimental-https`.
 * Permissions-Policy already allows camera=(self).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ScanLine } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button, type ButtonProps } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Overlay';
import { Input } from '@/components/ui/Field';
import type { VariantWithProduct } from '@/types';
import { playScanSound, unlockScanSound } from '@/lib/scan-sound';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
const DUPLICATE_WINDOW_MS = 1500;

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

type CameraState = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable';

export function BarcodeScannerButton({ onScan, label = 'Scan', ...btn }: { onScan: (v: VariantWithProduct) => void; label?: string } & Omit<ButtonProps, 'onClick' | 'children'>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button leading={<ScanLine />} onClick={() => { unlockScanSound(); setOpen(true); }} {...btn}>{label}</Button>
      {open && <ScannerSheet onClose={() => setOpen(false)} onScan={(v) => { onScan(v); setOpen(false); }} />}
    </>
  );
}

function ScannerSheet({ onClose, onScan }: { onClose: () => void; onScan: (v: VariantWithProduct) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<() => void>(() => undefined);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const busyRef = useRef(false);
  // Parents pass a new onScan on every render; reading it through a ref keeps the camera effect
  // from tearing down and restarting the stream (which stopped decoding from ever settling).
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [camera, setCamera] = useState<CameraState>('idle');
  const [engine, setEngine] = useState<'native' | 'zxing' | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = useCallback(async (raw: string): Promise<boolean> => {
    const c = raw.trim();
    if (!c || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setStatus(null);
    try {
      const v = await api.variants.lookup(/^\d+$/.test(c) ? { barcode: c } : { sku: c });
      playScanSound('ok');
      if (navigator.vibrate) navigator.vibrate(40);
      onScanRef.current(v);
      return true;
    } catch (e) {
      playScanSound('miss');
      setStatus({ kind: 'error', text: e instanceof ApiError && e.code === 'NOT_FOUND' ? `Not found: ${c}. Keep scanning or type the code.` : (e as Error).message });
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const onDetected = useCallback((raw: string) => {
    const now = Date.now();
    if (lastRef.current.code === raw && now - lastRef.current.at < DUPLICATE_WINDOW_MS) return;
    lastRef.current = { code: raw, at: now };
    void lookup(raw);
  }, [lookup]);

  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    if (!video) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setCamera('unavailable'); return; }
    setCamera('starting');

    const start = async () => {
      let stream: MediaStream;
      try {
        // 1D barcodes need resolution and focus; the browser default (~640×480) is often too blurry.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as { focusMode?: string[] };
        if (track && caps.focusMode?.includes('continuous')) void track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
      } catch (e) {
        if (cancelled) return;
        setCamera((e as DOMException).name === 'NotAllowedError' ? 'denied' : 'unavailable');
        return;
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      video.srcObject = stream;
      try { await video.play(); } catch { /* autoplay blocked until interaction; still decodes */ }
      setCamera('live');

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (Detector) {
        setEngine('native');
        const detector = new Detector({ formats: FORMATS });
        let inFlight = false;
        const timer = window.setInterval(async () => {
          if (video.readyState < 2 || inFlight) return;
          inFlight = true;
          try {
            const found = await detector.detect(video);
            const first = found[0];
            if (first?.rawValue) onDetected(first.rawValue);
          } catch { /* frame not ready */ } finally { inFlight = false; }
        }, 120);
        stopRef.current = () => window.clearInterval(timer);
        return;
      }

      setEngine('zxing');
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        if (cancelled) return;
        const hints = new Map<unknown, unknown>([
          [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE]],
          [DecodeHintType.TRY_HARDER, true],
        ]);
        const reader = new BrowserMultiFormatReader(hints as Map<never, unknown>, { delayBetweenScanAttempts: 100, delayBetweenScanSuccess: 500 });
        const controls = await reader.decodeFromStream(stream, video, (result) => { if (result) onDetected(result.getText()); });
        stopRef.current = () => controls.stop();
      } catch {
        if (!cancelled) setStatus({ kind: 'info', text: 'Live decoding is not available in this browser. Type the code instead.' });
      }
    };
    void start();

    return () => {
      cancelled = true;
      stopRef.current();
      stopRef.current = () => undefined;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (video) video.srcObject = null;
    };
    // Mount once: callbacks are read through refs/stable hooks, so the stream is never restarted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cameraMessage = camera === 'denied' ? 'Camera access was blocked. Allow it in the browser settings, or type the code below.'
    : camera === 'unavailable' ? (window.isSecureContext ? 'No camera found on this device. Type the code below.' : 'The camera needs HTTPS. Open the app over https:// (or run next dev --experimental-https) — or type the code below.')
    : null;

  return (
    <Sheet open onClose={onClose} title="Scan barcode" description={camera === 'live' ? 'Point the camera at the label, or type the code.' : 'Type the code, or allow the camera.'}>
      <div className={cn('relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-card bg-ink text-bg', camera !== 'live' && 'bg-ink/90')} aria-live="polite">
        <video ref={videoRef} playsInline muted autoPlay className={cn('absolute inset-0 size-full object-cover', camera !== 'live' && 'hidden')} />
        {camera === 'live' ? (
          <div aria-hidden className="relative flex h-32 w-56 items-center justify-center rounded-lg border-2 border-bg/70"><span className="absolute inset-x-2 top-1/2 h-0.5 bg-danger/80 motion-safe:animate-pulse" /></div>
        ) : camera === 'starting' ? (
          <p className="text-sm opacity-80">Starting camera…</p>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 text-center"><CameraOff className="size-8 opacity-70" aria-hidden /><p className="text-sm opacity-90">{cameraMessage}</p></div>
        )}
        {engine && camera === 'live' && <span className="absolute bottom-2 right-2 rounded-full bg-bg/15 px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-80">{engine === 'native' ? 'Native' : 'ZXing'}</span>}
      </div>
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void lookup(code); }}>
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Barcode or SKU" inputMode="numeric" aria-label="Barcode or SKU" invalid={status?.kind === 'error'} data-autofocus={camera !== 'live' ? true : undefined} leading={<Camera aria-hidden />} />
        <Button type="submit" variant="primary" loading={busy}>Find</Button>
      </form>
      {status && <p className={cn('mt-2 text-xs', status.kind === 'error' ? 'text-danger-ink' : 'text-ink-2')} role={status.kind === 'error' ? 'alert' : 'status'}>{status.text}</p>}
      <p className="mt-3 text-xs text-ink-2">EAN-13, EAN-8, UPC, Code 128, Code 39 and QR are read. Same code within 1.5 s is ignored.</p>
    </Sheet>
  );
}
