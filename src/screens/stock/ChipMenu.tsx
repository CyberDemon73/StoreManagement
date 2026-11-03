'use client';
/** Filter chip that opens a single-select menu ("Type: All", "Seller: Nour"). */
import { useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Chip } from '@/components/ui/Badge';
import { MenuItem, Popover } from '@/components/ui/Overlay';

export interface ChipMenuOption<T extends string> { value: T; label: ReactNode }

export function ChipMenu<T extends string>({ label, value, options, onChange, allLabel = 'All', size = 'md', hideAll }: {
  label: string;
  value: T | undefined;
  options: ChipMenuOption<T>[];
  onChange: (v: T | undefined) => void;
  allLabel?: string;
  size?: 'sm' | 'md' | 'touch';
  /** For sort menus where "All" makes no sense. */
  hideAll?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Popover open={open} onClose={() => setOpen(false)} align="start" anchor={
      <Chip size={size} selected={!!current && !hideAll} onClick={() => setOpen((o) => !o)} aria-label={`${label} filter`}>
        {label}: {current ? current.label : allLabel}<ChevronDown className="size-3.5 opacity-60" aria-hidden />
      </Chip>
    }>
      {!hideAll && <MenuItem selected={!current} onClick={() => { onChange(undefined); setOpen(false); }}>{allLabel}{!current && <Check className="ml-auto" aria-hidden />}</MenuItem>}
      {options.map((o) => (
        <MenuItem key={o.value} selected={o.value === value} onClick={() => { onChange(o.value); setOpen(false); }}>{o.label}{o.value === value && <Check className="ml-auto" aria-hidden />}</MenuItem>
      ))}
    </Popover>
  );
}
