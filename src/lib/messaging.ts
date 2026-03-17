import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app } from './firebase'; // we will export app from firebase.ts

export async function requestFCMToken() {
  try {
    const supported = await isSupported();
    if (!supported) {
      console.log('Firebase Messaging is not supported in this browser.');
      return null;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('Notification permission not granted.');
      return null;
    }

    const messaging = getMessaging(app);

    // Registramos el Service Worker pasándole las variables de entorno como parámetros URL
    // de esta manera no quedan "quemadas" en el archivo estático public/
    let registration;
    if ('serviceWorker' in navigator) {
      const swUrl = `/firebase-messaging-sw.js?apiKey=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}&projectId=${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}&messagingSenderId=${process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}&appId=${process.env.NEXT_PUBLIC_FIREBASE_APP_ID}`;
      registration = await navigator.serviceWorker.register(swUrl);
    }

    const currentToken = await getToken(messaging, {
      serviceWorkerRegistration: registration,
    });

    if (currentToken) {
      return currentToken;
    } else {
      console.log('No FCM token available.');
      return null;
    }
  } catch (error) {
    console.error('An error occurred while retrieving token. ', error);
    return null;
  }
}
