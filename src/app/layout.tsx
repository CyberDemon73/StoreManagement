import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { Providers } from '@/components/app/Providers';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Avenue Stock', template: '%s · Avenue Stock' },
  description: 'Inventory, sales and reporting for Avenue.',
  applicationName: 'Avenue Stock',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Avenue' },
  icons: { apple: '/icons/apple-touch-icon.png' }, // favicon.ico + icon.svg in src/app are picked up automatically
  openGraph: { title: 'Avenue Stock', description: 'Inventory, sales and reporting for the shop floor.', images: [{ url: '/brand/og-image.png', width: 1200, height: 630 }] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#3F6B5C' },
    { media: '(prefers-color-scheme: dark)', color: '#141715' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// Applies the saved theme before first paint to avoid a flash. Reads localStorage only.
const themeBootstrap = `(function(){try{var t=localStorage.getItem('avenue.theme');var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // src/middleware.ts sets a per-request CSP nonce and forwards it as `x-nonce`. Browsers hide the nonce
  // value from the DOM, so React would report a hydration mismatch on it; the attribute is suppressed.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
