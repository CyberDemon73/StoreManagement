import Link from 'next/link';

/** Public auth pages: centered card on the warm background. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span aria-hidden className="inline-flex size-14 items-center justify-center rounded-2xl bg-accent text-[26px] font-bold tracking-[-0.04em] text-accent-ink">A</span>
        <div><h1 className="text-[22px] font-semibold">Avenue Stock</h1><p className="text-sm text-ink-2">Zamalek store</p></div>
      </div>
      <div className="w-full max-w-[420px]">{children}</div>
      <p className="text-xs text-ink-2">v1.4.2 · <Link href="/login?demo=1" className="text-accent">Demo accounts</Link></p>
    </div>
  );
}
