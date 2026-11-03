'use client';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { moneyInputText, parseMoneyInput } from '@/lib/money-input';

/* ---------- Field wrapper: label + control + help/error ---------- */
export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}
export function Field({ label, htmlFor, help, error, trailing, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || trailing) && (
        <div className="flex items-center justify-between gap-2">
          {label && <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">{label}</label>}
          {trailing}
        </div>
      )}
      {children}
      {error ? <p className="text-xs text-danger-ink" role="alert">{error}</p> : help ? <p className="text-xs text-ink-2">{help}</p> : null}
    </div>
  );
}

/* ---------- Input ---------- */
const CONTROL = 'flex w-full items-center gap-2 rounded-input border border-line bg-surface px-3 text-ink transition-colors focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft';
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  leading?: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
  size?: 'md' | 'lg' | 'sm';
  wrapperClassName?: string;
  align?: 'left' | 'right' | 'center';
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ leading, trailing, invalid, size = 'md', className, wrapperClassName, align, ...rest }, ref) {
  return (
    <div className={cn(CONTROL, size === 'lg' ? 'min-h-12 text-[15px]' : size === 'sm' ? 'min-h-8 text-[13px]' : 'min-h-10', invalid && 'border-danger', rest.disabled && 'bg-surface-2 opacity-70', wrapperClassName)}>
      {leading && <span className="shrink-0 text-ink-2 [&_svg]:size-4">{leading}</span>}
      <input ref={ref} className={cn('min-w-0 flex-1 bg-transparent py-0 outline-none placeholder:text-ink-3', align === 'right' && 'text-right tabular', align === 'center' && 'text-center tabular', className)} aria-invalid={invalid || undefined} {...rest} />
      {trailing && <span className="shrink-0 text-ink-2 [&_svg]:size-4">{trailing}</span>}
    </div>
  );
});

/* ---------- Money input (minor units in, major display) ---------- */
export interface MoneyInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type'> {
  value: number | undefined; // minor units
  onChange: (minor: number | undefined) => void;
  currency?: string;
}
export function MoneyInput({ value, onChange, currency = 'EGP', ...rest }: MoneyInputProps) {
  return (
    <Input
      inputMode="numeric"
      pattern="[0-9]*"
      align="right"
      placeholder="0"
      leading={<span className="text-xs">{currency}</span>}
      value={moneyInputText(value)}
      onChange={(e) => onChange(parseMoneyInput(e.target.value))}
      {...rest}
    />
  );
}

/* ---------- Textarea ---------- */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={cn('min-h-[88px] w-full resize-y rounded-input border border-line bg-surface px-3 py-2.5 text-ink outline-none transition-colors focus:border-accent focus:ring-[3px] focus:ring-accent-soft', invalid && 'border-danger', className)} aria-invalid={invalid || undefined} {...rest} />;
});

/* ---------- Native select ---------- */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> { size?: 'md' | 'lg' | 'sm'; invalid?: boolean; wrapperClassName?: string }
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, size = 'md', invalid, wrapperClassName, children, ...rest }, ref) {
  return (
    <div className={cn(CONTROL, 'relative pr-2', size === 'lg' ? 'min-h-12 text-[15px]' : size === 'sm' ? 'min-h-8 text-[13px]' : 'min-h-10', invalid && 'border-danger', wrapperClassName)}>
      <select ref={ref} className={cn('min-w-0 flex-1 appearance-none bg-transparent py-0 pr-5 outline-none', className)} {...rest}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-ink-2" aria-hidden />
    </div>
  );
});

/* ---------- Checkbox ---------- */
export interface CheckboxProps { checked: boolean; onChange?: (v: boolean) => void; label?: ReactNode; disabled?: boolean; className?: string; 'aria-label'?: string; indeterminate?: boolean }
export function Checkbox({ checked, onChange, label, disabled, className, indeterminate, ...a11y }: CheckboxProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('inline-flex min-h-7 cursor-pointer items-center gap-2.5 text-sm', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input id={id} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} aria-label={a11y['aria-label']} />
      <span aria-hidden className={cn('flex size-[18px] items-center justify-center rounded-[5px] border-[1.5px] transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent', checked || indeterminate ? 'border-accent bg-accent text-accent-ink' : 'border-ink-3 bg-surface')}>
        {indeterminate ? <span className="h-0.5 w-2.5 bg-current" /> : checked ? <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : null}
      </span>
      {label}
    </label>
  );
}

/* ---------- Toggle / switch ---------- */
export interface ToggleProps { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean; className?: string; 'aria-label'?: string }
export function Toggle({ checked, onChange, label, description, disabled, className, ...a11y }: ToggleProps) {
  const id = useId();
  const control = (
    <button id={id} type="button" role="switch" aria-checked={checked} aria-label={a11y['aria-label']} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-accent' : 'bg-line')}>
      <span aria-hidden className={cn('absolute top-[3px] size-[18px] rounded-full bg-surface shadow-sm transition-[left] duration-150', checked ? 'left-[19px]' : 'left-[3px]')} />
    </button>
  );
  if (!label) return control;
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {control}
      <label htmlFor={id} className="cursor-pointer"><span className="block text-sm font-medium text-ink">{label}</span>{description && <span className="block text-xs text-ink-2">{description}</span>}</label>
    </div>
  );
}

/* ---------- Segmented control ---------- */
export interface SegmentedProps<T extends string> { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; disabled?: boolean }[]; size?: 'sm' | 'md' | 'lg'; className?: string; 'aria-label'?: string; grow?: boolean }
export function Segmented<T extends string>({ value, onChange, options, size = 'md', className, grow, ...a11y }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={a11y['aria-label']} className={cn('inline-flex gap-0.5 rounded-input bg-surface-2 p-[3px]', grow && 'flex w-full', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={o.disabled} onClick={() => onChange(o.value)}
          className={cn('rounded-[6px] font-medium transition-colors disabled:opacity-40', size === 'sm' ? 'min-h-7 px-2.5 text-xs' : size === 'lg' ? 'min-h-11 px-3 text-sm' : 'min-h-[34px] px-3 text-[13px]', grow && 'flex-1', value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
