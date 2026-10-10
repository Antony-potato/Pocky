// Service worker de notificaciones (FCM entrega aquí un push web estándar; no hace falta el SDK).
// Mostramos SIEMPRE una notificación por cada push:
// - iOS retira la suscripción si llegan pushes sin notificación visible, y el SDK de FCM no la
//   mostraba cuando creía que la app estaba abierta → en iPhone dejaban de llegar.
// - `tag`: si llegan varias juntas (Android en reposo), se ven como una sola en vez de una pila.
self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { data: { body: event.data.text() } }; }
  const n = msg.notification || msg.data || {};
  event.waitUntil(self.registration.showNotification(n.title || '¡Pocky te necesita!', {
    body: n.body || '',
    icon: '/icons/iconoPwa-192.png',
    badge: '/icons/iconoPwa-192.png',
    tag: 'pocky',
    renotify: true,
    data: { link: n.link || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const open = (await clients.matchAll({ type: 'window', includeUncontrolled: true }))[0];
    return open ? open.focus() : clients.openWindow(event.notification.data.link);
  })());
});
