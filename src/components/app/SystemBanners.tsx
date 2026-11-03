'use client';
import { useEffect, useState } from 'react';
import { Download, Eye, RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { useOnline, useLocalStorage } from '@/lib/use-api';
import { Button } from '@/components/ui/Button';
import { Logo } from './AppShell';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="no-print flex items-center gap-3 bg-warn-soft px-4 py-2.5 text-[13px] font-medium text-warn-ink">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">You&apos;re offline — catalogue is cached. Sales will sync when back online.</span>
    </div>
  );
}

export function ViewingAsBanner({ onExit }: { onExit: () => void }) {
  return (
    <div role="status" className="no-print flex items-center gap-3 bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink">
      <Eye className="size-4 shrink-0" aria-hidden />
      <span className="flex-1"><strong>Viewing as Seller</strong> — cost, profit, analytics, users and settings are hidden.</span>
      <button type="button" onClick={onExit} className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25">Exit</button>
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/** Shows after the browser fires beforeinstallprompt (Android/desktop) or an iOS hint in Safari. */
export function InstallPwaPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [dismissedAt, setDismissedAt] = useLocalStorage<number>('avenue.installDismissed', 0);
  useEffect(() => {
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua)) setIos(true);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  const hidden = Date.now() - dismissedAt < 14 * 86_400_000;
  if (hidden || (!evt && !ios)) return null;
  return (
    <div role="dialog" aria-label="Install Avenue" className="no-print fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm rounded-card border border-line bg-surface p-4 shadow-float md:bottom-6 md:right-6 md:left-auto">
      <div className="flex items-start gap-3">
        <Logo />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Install Avenue</p>
          {evt ? <p className="text-xs text-ink-2">Opens full-screen, works offline, one tap from your home screen.</p>
            : <p className="text-xs text-ink-2">Add Avenue to your Home Screen: tap <Share className="inline size-3.5 align-text-bottom" aria-label="Share" /> <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</p>}
        </div>
        <button type="button" aria-label="Not now" onClick={() => setDismissedAt(Date.now())} className="-mr-1 -mt-1 rounded p-1 text-ink-2 hover:bg-surface-2"><X className="size-4" /></button>
      </div>
      {evt && <div className="mt-3 flex gap-2"><Button variant="primary" size="sm" className="flex-1" leading={<Download />} onClick={async () => { await evt.prompt(); setEvt(null); }}>Install</Button><Button variant="ghost" size="sm" onClick={() => setDismissedAt(Date.now())}>Not now</Button></div>}
    </div>
  );
}

/** Listens for a waiting service worker and offers a refresh. Never auto-reloads mid-sale. */
export function UpdateAvailableToast() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let reg: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker.getRegistration().then((r) => {
      reg = r;
      if (!r) return;
      if (r.waiting) setWaiting(r.waiting);
      r.addEventListener('updatefound', () => { const sw = r.installing; sw?.addEventListener('statechange', () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(sw); }); });
    }).catch(() => undefined);
    return () => { void reg; };
  }, []);
  if (!waiting) return null;
  return (
    <div role="status" className="no-print fixed bottom-24 left-4 right-4 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-[10px] bg-ink px-4 py-3 text-sm text-bg shadow-float md:bottom-6 md:left-6 md:right-auto">
      <RefreshCw className="size-4 shrink-0" aria-hidden />
      <div className="flex-1"><p className="font-medium">A new version is available</p><p className="text-xs opacity-80">Refresh when you&apos;re not mid-sale.</p></div>
      <Button size="sm" variant="primary" onClick={() => { waiting.postMessage({ type: 'SKIP_WAITING' }); navigator.serviceWorker.addEventListener('controllerchange', () => location.reload()); }}>Refresh</Button>
    </div>
  );
}
