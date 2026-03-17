import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app } from './firebase';

/**
 * Intenta obtener un token FCM (Chrome/Android) o una suscripción Web Push nativa (Safari/iOS).
 * Retorna un objeto con el tipo y el valor para almacenarlos correctamente.
 */
export async function requestNotificationPermission(): Promise<
  | { type: 'fcm'; token: string }
  | { type: 'webpush'; subscription: PushSubscriptionJSON }
  | null
> {
  try {
    // 1. Pedir permiso de notificaciones al navegador
    if (!('Notification' in window)) {
      console.log('Este navegador no soporta notificaciones.');
      return null;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('Permiso de notificaciones denegado.');
      return null;
    }

    // 2. Intentar FCM primero (Chrome, Edge, Android)
    const fcmSupported = await isSupported();
    if (fcmSupported) {
      const messaging = getMessaging(app);

      let registration;
      if ('serviceWorker' in navigator) {
        const swUrl = `/firebase-messaging-sw.js?apiKey=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}&projectId=${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}&messagingSenderId=${process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}&appId=${process.env.NEXT_PUBLIC_FIREBASE_APP_ID}`;
        registration = await navigator.serviceWorker.register(swUrl);
      }

      const currentToken = await getToken(messaging, {
        serviceWorkerRegistration: registration,
      });

      if (currentToken) {
        return { type: 'fcm', token: currentToken };
      }
    }

    // 3. Fallback: Web Push nativo (Safari/iOS PWA)
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const registration = await navigator.serviceWorker.register('/sw-push.js');
      await navigator.serviceWorker.ready;

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        console.error('VAPID public key not configured.');
        return null;
      }

      // Convertir la clave VAPID a Uint8Array
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const subJSON = subscription.toJSON();
      return { type: 'webpush', subscription: subJSON };
    }

    console.log('Ni FCM ni Web Push están disponibles en este navegador.');
    return null;
  } catch (error) {
    console.error('Error al obtener permiso de notificaciones:', error);
    return null;
  }
}

// ---- Mantener compatibilidad con el código existente ----
export async function requestFCMToken(): Promise<string | null> {
  const result = await requestNotificationPermission();
  if (!result) return null;
  if (result.type === 'fcm') return result.token;
  // Si es webpush, retornamos null aquí — se maneja por separado
  return null;
}

// Utilidad: convierte una clave VAPID base64url a Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
