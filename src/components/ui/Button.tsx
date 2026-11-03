'use client';
import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'dangerSoft';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent border-accent text-accent-ink hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'bg-surface border-line text-ink hover:bg-surface-2',
  soft: 'bg-accent-soft border-transparent text-accent hover:bg-accent-soft/80',
  ghost: 'bg-transparent border-transparent text-ink hover:bg-surface-2',
  danger: 'bg-danger border-danger text-white hover:opacity-90',
  dangerSoft: 'bg-danger-soft border-transparent text-danger-ink hover:opacity-90',
};
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-2.5 text-[13px] gap-1.5 [&_svg]:size-4',
  md: 'min-h-10 px-3.5 text-sm gap-2 [&_svg]:size-4',
  lg: 'min-h-12 px-5 text-[15px] gap-2 [&_svg]:size-5',
  xl: 'min-h-14 px-6 text-[17px] font-semibold gap-2.5 [&_svg]:size-5',
};
const ICON_SIZE: Record<ButtonSize, string> = { sm: 'size-8 px-0', md: 'size-10 px-0', lg: 'size-12 px-0', xl: 'size-14 px-0' };

export function buttonClass(opts: { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean; block?: boolean; className?: string } = {}): string {
  const { variant = 'secondary', size = 'md', iconOnly, block, className } = opts;
  return cn(
    'inline-flex items-center justify-center rounded-input border font-medium whitespace-nowrap transition-colors duration-150 ease-out select-none',
    'disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:pointer-events-none',
    VARIANT[variant], SIZE[size], iconOnly && ICON_SIZE[size], block && 'w-full', className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  block?: boolean;
  loading?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, iconOnly, block, loading, leading, trailing, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass({ variant, size, iconOnly, block, className })} {...rest}>
      {loading ? <span className="skeleton size-4 shrink-0 rounded-full opacity-70" aria-hidden /> : leading}
      {children}
      {trailing}
    </button>
  );
});

export interface LinkButtonProps extends Omit<React.ComponentProps<typeof Link>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  block?: boolean;
  className?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
}

export function LinkButton({ variant, size, iconOnly, block, className, leading, trailing, children, disabled, ...rest }: LinkButtonProps) {
  return (
    <Link aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} className={buttonClass({ variant, size, iconOnly, block, className })} {...rest}>
      {leading}{children}{trailing}
    </Link>
  );
}
