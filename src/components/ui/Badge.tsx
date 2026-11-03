import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Role, SaleStatus, StockStatus } from '@/types';
import { initials } from '@/lib/format';

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  ok: 'bg-ok-soft text-ok-ink',
  warn: 'bg-warn-soft text-warn-ink',
  danger: 'bg-danger-soft text-danger-ink',
  info: 'bg-info-soft text-info-ink',
  accent: 'bg-accent-soft text-accent',
};

export function Badge({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex min-h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium', TONE[tone], className)}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const STOCK_TONE: Record<StockStatus, Tone> = { ok: 'ok', low: 'warn', out: 'danger' };
export function StockBadge({ status, qty, className }: { status: StockStatus; qty?: number; className?: string }) {
  const label = status === 'out' ? 'Out' : status === 'low' ? 'Low' : 'In stock';
  return <Badge tone={STOCK_TONE[status]} dot className={className}>{qty !== undefined ? `${qty} · ${label}` : label}</Badge>;
}

const SALE_TONE: Record<SaleStatus, Tone> = { COMPLETED: 'ok', PARTIALLY_REFUNDED: 'warn', REFUNDED: 'info', VOID: 'danger' };
const SALE_LABEL: Record<SaleStatus, string> = { COMPLETED: 'Completed', PARTIALLY_REFUNDED: 'Partially refunded', REFUNDED: 'Refunded', VOID: 'Void' };
export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  return <Badge tone={SALE_TONE[status]} dot>{SALE_LABEL[status]}</Badge>;
}

const ROLE_TONE: Record<Role, Tone> = { ADMIN: 'accent', MANAGER: 'info', SELLER: 'neutral' };
export function RoleBadge({ role, suffix }: { role: Role; suffix?: string }) {
  const label = role === 'ADMIN' ? 'Admin' : role === 'MANAGER' ? 'Manager' : 'Seller';
  return <Badge tone={ROLE_TONE[role]}>{label}{suffix ? ` · ${suffix}` : ''}</Badge>;
}

export function Avatar({ name, size = 'md', className, tone }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string; tone?: 'accent' | 'info' | 'warn' | 'neutral' }) {
  const sz = { xs: 'size-6 text-[10px]', sm: 'size-7 text-[11px]', md: 'size-8 text-xs', lg: 'size-12 text-base', xl: 'size-14 text-lg' }[size];
  const t = tone ?? ((['accent', 'info', 'warn', 'neutral'] as const)[name.length % 4] ?? 'neutral');
  const cls = { accent: 'bg-accent-soft text-accent', info: 'bg-info-soft text-info-ink', warn: 'bg-warn-soft text-warn-ink', neutral: 'bg-surface-2 text-ink-2' }[t];
  return <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', sz, cls, className)}>{initials(name)}</span>;
}

/** Product image placeholder (fixed aspect, lazy image when present). */
export function Thumb({ src, tint, alt = '', size = 'md', className }: { src?: string; tint?: string; alt?: string; size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero'; className?: string }) {
  const sz = { sm: 'size-8 rounded-md', md: 'size-10 rounded-lg', lg: 'size-16 rounded-[10px]', xl: 'size-24 rounded-xl', hero: 'size-40 rounded-xl' }[size];
  return (
    <span className={cn('block shrink-0 overflow-hidden border border-line bg-surface-2', sz, className)} style={{ background: src ? undefined : tint }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt={alt} loading="lazy" className="size-full object-cover" />}
    </span>
  );
}

export function ColorSwatch({ hex, name, size = 'sm', selected, disabled, onClick, className }: { hex: string; name?: string; size?: 'xs' | 'sm' | 'md' | 'touch'; selected?: boolean; disabled?: boolean; onClick?: () => void; className?: string }) {
  const sz = { xs: 'size-3', sm: 'size-3.5', md: 'size-7', touch: 'size-11' }[size];
  const style = { background: hex };
  const base = cn('inline-block shrink-0 rounded-full border border-black/10', sz, selected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface', disabled && 'opacity-35', className);
  if (onClick) return <button type="button" aria-label={`${name ?? hex}${disabled ? ', out of stock' : ''}`} aria-pressed={selected} disabled={disabled} onClick={onClick} className={base} style={style} />;
  return <span aria-hidden className={base} style={style} title={name} />;
}

export function Chip({ selected, onClick, onRemove, disabled, struck, size = 'md', className, children, leading, 'aria-label': ariaLabel }: { selected?: boolean; onClick?: () => void; onRemove?: () => void; disabled?: boolean; struck?: boolean; size?: 'sm' | 'md' | 'touch'; className?: string; children: ReactNode; leading?: ReactNode; 'aria-label'?: string }) {
  const cls = cn(
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition-colors',
    size === 'sm' ? 'min-h-7 px-2.5 text-xs' : size === 'touch' ? 'min-h-11 px-4 text-[15px]' : 'min-h-8 px-3 text-[13px]',
    selected ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink hover:bg-surface-2',
    struck && 'border-dashed text-ink-3 line-through', disabled && 'opacity-50', className,
  );
  if (onClick) return <button type="button" aria-pressed={selected} aria-label={ariaLabel} disabled={disabled} onClick={onClick} className={cls}>{leading}{children}</button>;
  return (
    <span className={cls}>{leading}{children}
      {onRemove && <button type="button" aria-label="Remove filter" onClick={onRemove} className="-mr-1 rounded-full p-0.5 hover:bg-black/5"><svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[5px] border border-line border-b-2 bg-surface-2 px-1.5 font-sans text-[11px] text-ink-2">{children}</kbd>;
}
