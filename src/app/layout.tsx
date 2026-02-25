import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
