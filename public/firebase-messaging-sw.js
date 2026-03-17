// public/firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

// Los valores se inyectarán en tiempo de construcción/ejecución o se pueden poner duros aquí si son públicos
// Por simplicidad, usaremos importScripts para importar config si es necesario, pero FCM v9+ compat
// requiere inicializar aquí.
firebase.initializeApp({
  apiKey: new URL(location).searchParams.get('apiKey'),
  projectId: new URL(location).searchParams.get('projectId'),
  messagingSenderId: new URL(location).searchParams.get('messagingSenderId'),
  appId: new URL(location).searchParams.get('appId')
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Mensaje en segundo plano recibido.', payload);

  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icons/icon-192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
