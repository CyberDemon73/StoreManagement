import Link from 'next/link';
import { LogoMark } from '@/components/app/Brand';

/** Public auth pages: centered card on the warm background. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <LogoMark size="xl" title="Avenue Stock" />
        <div><h1 className="text-[22px] font-semibold leading-none tracking-[-0.02em]">Avenue<span className="font-normal text-ink-2"> Stock</span></h1><p className="mt-1.5 text-sm text-ink-2">Zamalek store</p></div>
      </div>
      <div className="w-full max-w-[420px]">{children}</div>
      <p className="text-xs text-ink-2">v1.4.2 · <Link href="/login?demo=1" className="text-accent">Demo accounts</Link></p>
    </div>
  );
}
