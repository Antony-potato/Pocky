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
    // Opaca: con black-translucent iOS 26 pone un desenfoque bajo la hora que no se puede quitar.
    // Se pinta con theme-color = color del borde superior de la escena (PetScreen). Cambiarlo exige reinstalar la PWA.
    statusBarStyle: 'default',
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
