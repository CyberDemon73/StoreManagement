'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { useBreakpoint } from '@/lib/use-api';

/* ---------- shared focus/escape handling ---------- */
function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => { const el = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button'); el?.focus(); }, 30);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; clearTimeout(t); prev?.focus?.(); };
  }, [open, onClose]);
  return ref;
}

function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

function Scrim({ onClick }: { onClick: () => void }) {
  return <div aria-hidden className="fixed inset-0 z-[70] bg-ink/35 animate-in" onClick={onClick} />;
}

export interface OverlayProps { open: boolean; onClose: () => void; title?: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string; headerAction?: ReactNode }

/** Mobile bottom sheet. Slides up; full-screen when `full`. */
export function Sheet({ open, onClose, title, description, children, footer, className, headerAction, full }: OverlayProps & { full?: boolean }) {
  const ref = useModal(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <Portal>
      <Scrim onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined}
        className={cn('fixed inset-x-0 bottom-0 z-[80] flex flex-col rounded-t-2xl bg-surface shadow-float motion-safe:animate-[slideUp_200ms_ease-out]', full ? 'top-[max(12px,env(safe-area-inset-top))]' : 'max-h-[92dvh]', className)}>
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line" aria-hidden />
        {(title || headerAction) && (
          <div className="flex items-start gap-3 px-4 pb-2 pt-3">
            <div className="min-w-0 flex-1">{title && <h2 id={id} className="text-[17px] font-semibold">{title}</h2>}{description && <p className="text-xs text-ink-2">{description}</p>}</div>
            {headerAction}
            <Button variant="ghost" iconOnly aria-label="Close" onClick={onClose}><X /></Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 safe-bottom">{footer}</div>}
      </div>
      <style>{`@keyframes slideUp{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}@keyframes slideIn{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}`}</style>
    </Portal>
  );
}

/** Desktop side drawer (right). */
export function Drawer({ open, onClose, title, description, children, footer, className, headerAction, width = 'md' }: OverlayProps & { width?: 'md' | 'lg' }) {
  const ref = useModal(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <Portal>
      <Scrim onClick={onClose} />
      <aside ref={ref} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined}
        className={cn('fixed inset-y-0 right-0 z-[80] flex w-full flex-col border-l border-line bg-surface shadow-float motion-safe:animate-[slideIn_200ms_ease-out]', width === 'lg' ? 'md:w-[560px]' : 'md:w-[460px]', className)}>
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">{title && <h2 id={id} className="text-base font-semibold">{title}</h2>}{description && <p className="text-xs text-ink-2">{description}</p>}</div>
          {headerAction}
          <Button variant="ghost" iconOnly aria-label="Close" onClick={onClose}><X /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-5 py-4">{footer}</div>}
      </aside>
      <style>{`@keyframes slideIn{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}`}</style>
    </Portal>
  );
}

/** Sheet on mobile, Drawer on tablet/desktop. */
export function Panel(props: OverlayProps & { width?: 'md' | 'lg' }) {
  const bp = useBreakpoint();
  return bp === 'mobile' ? <Sheet {...props} /> : <Drawer {...props} />;
}

export function Dialog({ open, onClose, title, description, children, footer, className, danger }: OverlayProps & { danger?: boolean }) {
  const ref = useModal(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <Portal>
      <Scrim onClick={onClose} />
      <div className="fixed inset-0 z-[80] flex items-end justify-center p-4 md:items-center">
        <div ref={ref} role={danger ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={id} className={cn('w-full max-w-[440px] rounded-card border border-line bg-surface p-6 shadow-float motion-safe:animate-[slideUp_180ms_ease-out]', className)}>
          <h2 id={id} className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-1.5 text-sm text-ink-2">{description}</p>}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-5 flex flex-col-reverse justify-end gap-2 md:flex-row">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

/** Confirm dialog with a required reason field when `reasonRequired`. */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', danger, pending, children }: { open: boolean; onClose: () => void; onConfirm: () => void; title: ReactNode; description?: ReactNode; confirmLabel?: string; danger?: boolean; pending?: boolean; children?: ReactNode }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} danger={danger}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={pending} data-autofocus>{confirmLabel}</Button></>}>
      {children}
    </Dialog>
  );
}

/** Small anchored menu (click outside / Esc closes). */
export function Popover({ open, onClose, anchor, children, align = 'end', className }: { open: boolean; onClose: () => void; anchor: ReactNode; children: ReactNode; align?: 'start' | 'end'; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  return (
    <div ref={ref} className="relative">
      {anchor}
      {open && <div className={cn('absolute top-full z-[60] mt-1.5 min-w-[200px] rounded-card border border-line bg-surface p-1.5 shadow-float', align === 'end' ? 'right-0' : 'left-0', className)}>{children}</div>}
    </div>
  );
}

export function MenuItem({ onClick, children, danger, className, selected, href }: { onClick?: () => void; children: ReactNode; danger?: boolean; className?: string; selected?: boolean; href?: string }) {
  const cls = cn('flex w-full min-h-9 items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-surface-2 [&_svg]:size-4', danger ? 'text-danger-ink' : 'text-ink', selected && 'bg-accent-soft text-accent', className);
  if (href) return <a href={href} className={cls}>{children}</a>;
  return <button type="button" role="menuitem" onClick={onClick} className={cls}>{children}</button>;
}
