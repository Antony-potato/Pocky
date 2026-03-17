// Service Worker para Web Push nativo (Safari/iOS PWA)
self.addEventListener('push', function(event) {
  let data = { title: '¡Pocky te necesita!', body: 'Tu mascota te extraña 🐾' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icons/iconoPwa-192.png',
    badge: '/icons/iconoPwa-192.png',
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
