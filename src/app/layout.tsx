import type { Metadata, Viewport } from 'next';
import { Nunito } from 'next/font/google';
import './globals.css';

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
  weight: ['600', '700', '800', '900'],
});

export const metadata: Metadata = {
  title: 'Pocky 🐰',
  description: 'Nuestra mascota virtual',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent', // la escena se ve bajo la hora, sin franja blanca
    title: 'Pocky',
  },
  icons: {
    apple: '/icons/iconoPwa-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#151a19', // barra de estado de Android en el tono del HUD
  viewportFit: 'cover', // ocupar toda la pantalla; el HUD respeta env(safe-area-inset-*)
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={nunito.variable}>
      <body className="antialiased font-nunito">{children}</body>
    </html>
  );
}
