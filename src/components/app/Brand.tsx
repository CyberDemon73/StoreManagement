import { cn } from '@/lib/cn';

/**
 * Brand primitives. The mark is an "A" whose crossbar runs on as a clothes rail, with a sand
 * dot (the hanger) — stock on the rail. Source files: public/brand/*.svg; guide: docs/BRAND.md.
 */
const SIZES = { xs: 20, sm: 24, md: 32, lg: 48, xl: 64, hero: 96 } as const;
export type LogoSize = keyof typeof SIZES;

export interface LogoMarkProps {
  size?: LogoSize | number;
  /** `tile` = sage tile with white glyph (default). `mono` = glyph only in currentColor. */
  variant?: 'tile' | 'mono';
  className?: string;
  title?: string;
}

export function LogoMark({ size = 'md', variant = 'tile', className, title }: LogoMarkProps) {
  const px = typeof size === 'number' ? size : SIZES[size];
  const glyph = (
    <>
      <path d="M15 49 L32 15 L49 49" fill="none" stroke={variant === 'tile' ? '#FFFFFF' : 'currentColor'} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22.5 37.5 H54" fill="none" stroke={variant === 'tile' ? '#FFFFFF' : 'currentColor'} strokeWidth="6.5" strokeLinecap="round" />
      <circle cx="54" cy="29" r="3.25" fill={variant === 'tile' ? '#C8B89A' : 'currentColor'} />
    </>
  );
  return (
    <svg width={px} height={px} viewBox="0 0 64 64" className={cn('shrink-0', className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {variant === 'tile' && <rect width="64" height="64" rx="16" fill="#3F6B5C" />}
      {glyph}
    </svg>
  );
}

export function Wordmark({ className, size = 'md', tone = 'ink' }: { className?: string; size?: 'sm' | 'md' | 'lg'; tone?: 'ink' | 'inverse' }) {
  const cls = size === 'lg' ? 'text-[26px]' : size === 'sm' ? 'text-sm' : 'text-lg';
  return (
    <span className={cn('whitespace-nowrap font-semibold leading-none tracking-[-0.02em]', cls, tone === 'inverse' ? 'text-accent-ink' : 'text-ink', className)}>
      Avenue<span className={cn('font-normal', tone === 'inverse' ? 'opacity-80' : 'text-ink-2')}> Brand</span>
    </span>
  );
}

/** Mark + wordmark side by side. */
export function LogoLockup({ size = 'md', subtitle, className, tone = 'ink' }: { size?: 'sm' | 'md' | 'lg'; subtitle?: string; className?: string; tone?: 'ink' | 'inverse' }) {
  const mark: LogoSize = size === 'lg' ? 'xl' : size === 'sm' ? 'sm' : 'md';
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <LogoMark size={mark} />
      <span className="flex flex-col gap-0.5">
        <Wordmark size={size} tone={tone} />
        {subtitle && <span className={cn('text-[11px] leading-none', tone === 'inverse' ? 'text-accent-ink/80' : 'text-ink-2')}>{subtitle}</span>}
      </span>
    </span>
  );
}
