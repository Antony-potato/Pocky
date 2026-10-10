// Service worker de FCM. La config llega por query string desde src/lib/messaging.ts.
// No hace falta onBackgroundMessage: el SDK ya muestra las notificaciones con payload `notification`
// y abre `webpush.fcmOptions.link` al tocarlas (mostrarlas aquí otra vez las duplicaba).
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

const params = new URL(location).searchParams;
firebase.initializeApp({
  apiKey: params.get('apiKey'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
});

firebase.messaging();
