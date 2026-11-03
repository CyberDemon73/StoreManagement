'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { useRouter } from 'next/navigation';

export interface Crumb { label: string; href?: string }

/**
 * Page title row. On mobile the title is portalled into the top bar; on desktop it renders a
 * header row with breadcrumb and actions.
 */
export function PageHeader({ title, crumbs, actions, description, back, className, children, compactTitle }: { title: ReactNode; crumbs?: Crumb[]; actions?: ReactNode; description?: ReactNode; back?: string | true; className?: string; children?: ReactNode; compactTitle?: string }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById('page-title-slot')); }, []);
  const router = useRouter();
  const backBtn = back ? (typeof back === 'string' ? <Link href={back} aria-label="Back" className="-ml-1 flex size-10 items-center justify-center rounded-lg hover:bg-surface-2"><ArrowLeft className="size-5" /></Link> : <Button variant="ghost" iconOnly aria-label="Back" onClick={() => router.back()}><ArrowLeft /></Button>) : null;
  return (
    <>
      {slot && createPortal(
        <div className="flex items-center gap-1 md:hidden">{backBtn}<h1 className="truncate text-[17px] font-semibold">{compactTitle ?? title}</h1></div>,
        slot,
      )}
      <div className={cn('flex flex-col gap-3 px-4 pt-4 md:flex-row md:items-end md:justify-between md:px-6 md:pt-6', className)}>
        <div className="hidden min-w-0 items-start gap-2 md:flex">
          {backBtn}
          <div className="min-w-0">
            {crumbs && crumbs.length > 0 && (
              <nav aria-label="Breadcrumb" className="mb-0.5 flex items-center gap-1.5 text-xs text-ink-2">
                {crumbs.map((c, i) => <span key={i} className="flex items-center gap-1.5">{c.href ? <Link href={c.href} className="hover:text-ink">{c.label}</Link> : <span>{c.label}</span>}{i < crumbs.length - 1 && <span aria-hidden>/</span>}</span>)}
              </nav>
            )}
            <h1 className="truncate text-xl font-semibold md:text-2xl">{title}</h1>
            {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
          </div>
        </div>
        {description && <p className="text-sm text-ink-2 md:hidden">{description}</p>}
        {actions && <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div>}
      </div>
      {children}
    </>
  );
}

/** Standard page padding. */
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn('mx-auto flex w-full flex-col gap-4 px-4 py-4 md:gap-5 md:px-6 md:py-5', !wide && 'max-w-[1600px]', className)}>{children}</div>;
}
