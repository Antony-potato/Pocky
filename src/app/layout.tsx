import type { Metadata, Viewport } from 'next';
import { Outfit, Inter, Caveat } from 'next/font/google';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const caveat = Caveat({
  subsets: ['latin'],
  variable: '--font-caveat',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title:       'Pocky 🐰',
  description: 'Nuestra mascota virtual',
  manifest:    '/manifest.json',
  appleWebApp: {
    capable:          true,
    statusBarStyle:   'default',
    title:            'Pocky',
  },
  icons: {
    apple: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor:          '#FFF5E4',
  width:               'device-width',
  initialScale:        1,
  maximumScale:        1,
  userScalable:        false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${outfit.variable} ${inter.variable} ${caveat.variable}`}>
      <body className="antialiased font-inter">{children}</body>
    </html>
  );
}
