import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Dev por Tailscale: sin esto Next bloquea el HMR desde otro host (nombre MagicDNS o IP 100.x).
  allowedDevOrigins: ['*.ts.net', '100.*.*.*'],
  // Headers para PWA y seguridad
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Content-Type', value: 'application/javascript' },
        ],
      },
    ];
  },
};

export default nextConfig;
