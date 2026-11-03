'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Calendar, Check, ChevronDown, Minus, Plus, ScanLine, Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Input } from './Field';
import { Chip, Kbd } from './Badge';
import { Popover, MenuItem } from './Overlay';
import { DATE_PRESETS, dateRangeFor } from '@/lib/format';
import type { DateRange, DateRangePreset } from '@/types';

/* ---------- Tabs ---------- */
export interface TabItem<T extends string> { value: T; label: ReactNode; count?: number; disabled?: boolean }
export function Tabs<T extends string>({ value, onChange, items, className, scroll }: { value: T; onChange: (v: T) => void; items: TabItem<T>[]; className?: string; scroll?: boolean }) {
  return (
    <div role="tablist" className={cn('flex gap-1 border-b border-line', scroll && 'scrollbar-none overflow-x-auto whitespace-nowrap', className)}>
      {items.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} disabled={t.disabled} onClick={() => onChange(t.value)}
          className={cn('-mb-px min-h-11 border-b-2 px-3.5 text-sm font-medium transition-colors disabled:opacity-40', value === t.value ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-ink-2">· {t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Quantity input (big − / +) ---------- */
export function QuantityInput({ value, onChange, min = 0, max = 9999, size = 'md', className, 'aria-label': ariaLabel = 'Quantity', disabled }: { value: number; onChange: (v: number) => void; min?: number; max?: number; size?: 'sm' | 'md'; className?: string; 'aria-label'?: string; disabled?: boolean }) {
  const btn = size === 'sm' ? 'size-8 text-base' : 'size-11 text-xl';
  return (
    <div role="group" aria-label={ariaLabel} className={cn('inline-flex items-stretch overflow-hidden rounded-input border border-line bg-surface', disabled && 'opacity-50', className)}>
      <button type="button" aria-label="Decrease" disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))} className={cn(btn, 'flex items-center justify-center text-ink hover:bg-surface-2 disabled:opacity-40')}><Minus className="size-4" aria-hidden /></button>
      <input type="number" inputMode="numeric" value={value} min={min} max={max} disabled={disabled} aria-live="polite" onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }}
        className={cn('tabular w-11 border-x border-line bg-transparent text-center font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none', size === 'sm' ? 'w-9 text-sm' : '')} />
      <button type="button" aria-label="Increase" disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))} className={cn(btn, 'flex items-center justify-center text-ink hover:bg-surface-2 disabled:opacity-40')}><Plus className="size-4" aria-hidden /></button>
    </div>
  );
}

/* ---------- Search input (+ scan button) ---------- */
export function SearchInput({ value, onChange, placeholder = 'Search…', onScan, size = 'md', className, autoFocus, showKbd, 'aria-label': ariaLabel = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string; onScan?: () => void; size?: 'md' | 'lg'; className?: string; autoFocus?: boolean; showKbd?: boolean; 'aria-label'?: string }) {
  return (
    <Input type="search" size={size} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel} autoFocus={autoFocus} wrapperClassName={className}
      leading={<Search aria-hidden />}
      trailing={<span className="flex items-center gap-1">{value && <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="rounded p-0.5 hover:bg-surface-2"><X className="size-4" /></button>}{showKbd && !value && <Kbd>⌘K</Kbd>}{onScan && <button type="button" aria-label="Scan barcode" onClick={onScan} className="rounded p-1 hover:bg-surface-2"><ScanLine className="size-4" /></button>}</span>} />
  );
}

/* ---------- Filter bar (chips + More) ---------- */
export interface FilterChipDef { key: string; label: string; value?: string; onClear?: () => void; onClick?: () => void }
export function FilterBar({ chips, onMore, children, className }: { chips: FilterChipDef[]; onMore?: () => void; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('scrollbar-none flex items-center gap-1.5 overflow-x-auto', className)}>
      {chips.map((c) => (
        <Chip key={c.key} selected={!!c.value} onClick={c.onClick} onRemove={c.value && !c.onClick ? c.onClear : undefined}>
          {c.value ? `${c.label}: ${c.value}` : c.label}{c.onClick && !c.value && <ChevronDown className="size-3.5 opacity-60" aria-hidden />}
        </Chip>
      ))}
      {onMore && <Chip onClick={onMore} leading={<SlidersHorizontal className="size-3.5" aria-hidden />}>More filters</Chip>}
      {children}
    </div>
  );
}

/* ---------- Date range picker ---------- */
export function DateRangePicker({ value, onChange, className, compact }: { value: DateRange; onChange: (r: DateRange) => void; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const pickPreset = (p: DateRangePreset) => { if (p === 'custom') { setOpen(true); return; } onChange(dateRangeFor(p)); setOpen(false); };
  if (compact) {
    return (
      <Popover open={open} onClose={() => setOpen(false)} anchor={<Button size="sm" leading={<Calendar />} trailing={<ChevronDown />} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={className}>{DATE_PRESETS.find((d) => d.key === value.preset)?.label.replace('…', '') ?? 'Range'}</Button>}>
        <PresetMenu value={value} onPick={pickPreset} />
        <CustomRange from={from} to={to} setFrom={setFrom} setTo={setTo} onApply={() => { onChange(dateRangeFor('custom', new Date(), { from, to })); setOpen(false); }} />
      </Popover>
    );
  }
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div role="radiogroup" aria-label="Date range" className="inline-flex gap-0.5 rounded-input bg-surface-2 p-[3px]">
        {DATE_PRESETS.map((p) => (
          <button key={p.key} type="button" role="radio" aria-checked={value.preset === p.key} onClick={() => pickPreset(p.key)} className={cn('min-h-[34px] rounded-[6px] px-3 text-[13px] font-medium transition-colors', value.preset === p.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>{p.label}</button>
        ))}
      </div>
      {open && (
        <Popover open={open} onClose={() => setOpen(false)} anchor={<span />}>
          <CustomRange from={from} to={to} setFrom={setFrom} setTo={setTo} onApply={() => { onChange(dateRangeFor('custom', new Date(), { from, to })); setOpen(false); }} />
        </Popover>
      )}
    </div>
  );
}
function PresetMenu({ value, onPick }: { value: DateRange; onPick: (p: DateRangePreset) => void }) {
  return <div className="flex flex-col">{DATE_PRESETS.filter((p) => p.key !== 'custom').map((p) => <MenuItem key={p.key} selected={value.preset === p.key} onClick={() => onPick(p.key)}>{p.label}{value.preset === p.key && <Check className="ml-auto" aria-hidden />}</MenuItem>)}<div className="my-1 h-px bg-line" /></div>;
}
function CustomRange({ from, to, setFrom, setTo, onApply }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; onApply: () => void }) {
  return (
    <div className="flex flex-col gap-2 p-1.5">
      <p className="text-xs font-medium text-ink-2">Custom range</p>
      <div className="flex items-center gap-2"><Input type="date" size="sm" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><span className="text-ink-3">–</span><Input type="date" size="sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></div>
      <Button size="sm" variant="primary" onClick={onApply} disabled={!from || !to || from > to}>Apply</Button>
    </div>
  );
}

/* ---------- Combobox (search + create) ---------- */
export interface ComboOption { value: string; label: string; hint?: string; leading?: ReactNode }
export function Combobox({ value, onChange, options, placeholder = 'Search…', onCreate, createLabel = 'Create', size = 'md', className, 'aria-label': ariaLabel, disabled, invalid }: { value: string | undefined; onChange: (v: string) => void; options: ComboOption[]; placeholder?: string; onCreate?: (text: string) => void; createLabel?: string; size?: 'md' | 'lg'; className?: string; 'aria-label'?: string; disabled?: boolean; invalid?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const selected = options.find((o) => o.value === value);
  const q = text.trim().toLowerCase();
  const visible = options.filter((o) => !q || o.label.toLowerCase().includes(q)).slice(0, 8);
  const exact = options.some((o) => o.label.toLowerCase() === q);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', onDown); return () => document.removeEventListener('mousedown', onDown); }, [open]);
  return (
    <div ref={ref} className={cn('relative', className)}>
      <Input size={size} role="combobox" aria-expanded={open} aria-label={ariaLabel} placeholder={selected ? selected.label : placeholder} value={open ? text : selected?.label ?? ''} disabled={disabled} invalid={invalid}
        onFocus={() => { setOpen(true); setText(''); }} onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && open) { e.preventDefault(); const first = visible[0]; if (first) { onChange(first.value); setOpen(false); } else if (onCreate && q && !exact) { onCreate(text.trim()); setOpen(false); } } }}
        trailing={<ChevronDown aria-hidden />} />
      {open && (
        <div role="listbox" className="absolute z-[60] mt-1 w-full rounded-card border border-line bg-surface p-1.5 shadow-float">
          {visible.map((o) => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(o.value); setOpen(false); }} className={cn('flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-surface-2', o.value === value && 'bg-accent-soft text-accent')}>
              {o.leading}<span className="flex-1 truncate">{o.label}</span>{o.hint && <span className="text-xs text-ink-2">{o.hint}</span>}{o.value === value && <Check className="size-4" aria-hidden />}
            </button>
          ))}
          {visible.length === 0 && !onCreate && <p className="px-3 py-2 text-sm text-ink-2">No matches</p>}
          {onCreate && q && !exact && (<><div className="my-1 h-px bg-line" /><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onCreate(text.trim()); setOpen(false); }} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-accent hover:bg-surface-2"><Plus className="size-4" aria-hidden />{createLabel} “{text.trim()}”</button></>)}
        </div>
      )}
    </div>
  );
}

/* ---------- Stepper (wizard progress) ---------- */
export function Stepper({ steps, current, className, onStep }: { steps: string[]; current: number; className?: string; onStep?: (i: number) => void }) {
  return (
    <ol className={cn('flex items-center gap-1.5 text-xs', className)}>
      {steps.map((s, i) => {
        const done = i < current, active = i === current;
        const dot = <span aria-hidden className={cn('flex size-6 items-center justify-center rounded-full text-[11px] font-semibold', done ? 'bg-accent text-accent-ink' : active ? 'border-2 border-accent bg-surface text-ink' : 'bg-surface-2 text-ink-2')}>{done ? <Check className="size-3.5" /> : i + 1}</span>;
        return (
          <li key={s} className="flex flex-1 items-center gap-1.5 last:flex-none" aria-current={active ? 'step' : undefined}>
            {onStep && done ? <button type="button" onClick={() => onStep(i)} className="flex items-center gap-1.5 rounded-md">{dot}<span className="text-ink-2">{s}</span></button> : <span className="flex items-center gap-1.5">{dot}<span className={cn(active ? 'font-semibold text-ink' : 'text-ink-2', 'hidden sm:inline')}>{s}</span></span>}
            {i < steps.length - 1 && <span aria-hidden className={cn('h-px flex-1', done ? 'bg-accent' : 'bg-line')} />}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Size chip ---------- */
export function SizeChip({ size, selected, available, onClick, touch }: { size: string; selected?: boolean; available?: number; onClick?: () => void; touch?: boolean }) {
  const out = available !== undefined && available <= 0;
  return <Chip size={touch ? 'touch' : 'md'} selected={selected} struck={out} disabled={out} onClick={onClick} aria-label={`${size}${out ? ', out of stock' : available !== undefined ? `, ${available} available` : ''}`}>{out ? `${size} · 0` : size}</Chip>;
}
