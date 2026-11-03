'use client';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ToastKind = 'success' | 'error' | 'info' | 'pending';
export interface ToastInput { kind?: ToastKind; title: string; body?: string; action?: { label: string; onClick: () => void }; durationMs?: number }
interface ToastItem extends ToastInput { id: number }
interface ToastValue { toast: (t: ToastInput) => number; dismiss: (id: number) => void }

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    const ms = t.durationMs ?? (t.kind === 'error' ? 6000 : t.kind === 'pending' ? 60_000 : 3500);
    if (ms > 0) setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-[90] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6">
        {items.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={cn('pointer-events-auto flex max-w-sm items-center gap-3 rounded-[10px] px-4 py-3 text-sm shadow-float', t.kind === 'error' ? 'bg-danger text-white' : t.kind === 'pending' ? 'border border-line bg-surface text-ink' : 'bg-ink text-bg')}>
            {t.kind === 'success' && <Check className="size-4 shrink-0" aria-hidden />}
            {t.kind === 'error' && <CircleAlert className="size-4 shrink-0" aria-hidden />}
            {t.kind === 'pending' && <span className="skeleton size-3.5 shrink-0 rounded-full" aria-hidden />}
            <div className="min-w-0 flex-1"><p className="font-medium">{t.title}</p>{t.body && <p className="text-xs opacity-80">{t.body}</p>}</div>
            {t.action && <button type="button" className="rounded-md px-2 py-1 text-sm font-medium underline-offset-2 hover:underline" onClick={() => { t.action?.onClick(); dismiss(t.id); }}>{t.action.label}</button>}
            <button type="button" aria-label="Dismiss" className="-mr-1 rounded-md p-1 opacity-70 hover:opacity-100" onClick={() => dismiss(t.id)}><X className="size-4" aria-hidden /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}
