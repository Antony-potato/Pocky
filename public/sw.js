/**
 * Service worker único de Pocky.
 *
 * Antes había dos (`firebase-messaging-sw.js` y `sw-push.js`) registrados ambos
 * en el scope '/'. Las registraciones se indexan por scope, no por URL, así que
 * el segundo desinstalaba al primero y las notificaciones dejaban de llegar de
 * forma aparentemente aleatoria.
 *
 * Responsabilidades: shell offline de la PWA + Web Push (VAPID estándar, que
 * cubre Chrome, Firefox, Edge y Safari/iOS 16.4+).
 */
const CACHE = 'pocky-v1';

const PRECACHE = [
  '/',
  '/manifest.json',
  '/icons/iconoPwa-192.png',
  '/icons/iconoPwa-512.png',
  '/pocky-cat/pockyNormal.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // Un asset que falle no debe impedir la instalación del SW.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navegación: red primero, con el shell cacheado como red de seguridad.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    );
    return;
  }

  // Assets con hash en el nombre: inmutables, caché primero.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
        return res;
      })),
    );
  }
});

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let data = { title: '¡Pocky te necesita!', body: 'Tu mascota te extraña 🐾', url: '/' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:  data.body,
      icon:  '/icons/iconoPwa-192.png',
      badge: '/icons/iconoPwa-192.png',
      // Un tag estable hace que un aviso nuevo REEMPLACE al anterior en vez de
      // apilarse: solo importa el estado actual de Pocky.
      tag:      'pocky-needs',
      renotify: true,
      data:     { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Enfocar la ventana existente en vez de abrir una nueva (en iOS abrir otra
    // implicaba recargar la PWA entera).
    const existing = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      if ('navigate' in existing) await existing.navigate(target).catch(() => undefined);
      return;
    }
    await self.clients.openWindow(target);
  })());
});
