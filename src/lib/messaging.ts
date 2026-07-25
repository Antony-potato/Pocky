'use client';

/**
 * Notificaciones push sobre Web Push estándar (VAPID).
 *
 * Se retiró Firebase Cloud Messaging: el protocolo Web Push cubre Chrome,
 * Firefox, Edge, Android y Safari/iOS 16.4+ por sí solo, con un único service
 * worker y un único par de claves. La ruta FCM anterior además hacía
 * inalcanzable el fallback de Safari — un fallo de `getToken()` salía por el
 * `catch` común y devolvía null sin llegar nunca a intentar Web Push nativo.
 */

const SW_URL = '/sw.js';
/** Service workers del esquema anterior, que se desregistran al arrancar. */
const LEGACY_SW = ['/firebase-messaging-sw.js', '/sw-push.js'];

export type NotificationState =
  | 'unsupported'    // el navegador no soporta push
  | 'needs-install'  // iOS: hay que añadir a pantalla de inicio primero
  | 'default'        // aún no se ha preguntado
  | 'granted'
  | 'denied';

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function getNotificationState(): NotificationState {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    // En iOS las tres APIs solo existen dentro de la PWA instalada.
    return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (isIOS() && !isStandalone()) return 'needs-install';
  return Notification.permission as NotificationState;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const view = new Uint8Array(a);
  if (view.length !== b.length) return false;
  return view.every((v, i) => v === b[i]);
}

/** Registra el service worker y desregistra los del esquema anterior. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;

  try {
    const existing = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      existing
        .filter(r => LEGACY_SW.some(url => r.active?.scriptURL.endsWith(url)))
        .map(r => r.unregister()),
    );

    const registration = await navigator.serviceWorker.register(SW_URL);
    await navigator.serviceWorker.ready;
    return registration;
  } catch (e) {
    console.error('No se pudo registrar el service worker:', e);
    return null;
  }
}

async function subscribe(registration: ServiceWorkerRegistration): Promise<PushSubscriptionJSON | null> {
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) {
    console.error('NEXT_PUBLIC_VAPID_PUBLIC_KEY no está configurada.');
    return null;
  }
  const key = urlBase64ToUint8Array(vapid);

  const current = await registration.pushManager.getSubscription();
  if (current) {
    // Si la clave VAPID cambió, la suscripción vieja ya no sirve.
    if (sameKey(current.options.applicationServerKey, key)) return current.toJSON();
    await current.unsubscribe();
  }

  const sub = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key.slice().buffer as ArrayBuffer,
  });
  return sub.toJSON();
}

/**
 * Pide permiso y suscribe. DEBE llamarse desde un gesto del usuario.
 *
 * Antes esto se disparaba solo al montar la pantalla: en Safari/iOS eso falla
 * siempre (WebKit exige gesto) y en el resto de navegadores arriesga un
 * `denied` permanente que deja el botón 🔔 inservible para siempre.
 */
export async function requestPushPermission(): Promise<PushSubscriptionJSON | null> {
  const state = getNotificationState();
  if (state === 'unsupported' || state === 'needs-install' || state === 'denied') return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const registration = await registerServiceWorker();
  if (!registration) return null;

  try {
    return await subscribe(registration);
  } catch (e) {
    console.error('No se pudo suscribir a Web Push:', e);
    return null;
  }
}

/**
 * Si el permiso ya estaba concedido, asegura que exista una suscripción válida
 * y la devuelve. No abre ningún diálogo, así que puede llamarse al arrancar.
 *
 * Necesario tras el cambio de service worker: las suscripciones creadas contra
 * el SW anterior dejan de ser válidas y hay que rehacerlas sin molestar al
 * usuario.
 */
export async function ensurePushSubscription(): Promise<PushSubscriptionJSON | null> {
  if (getNotificationState() !== 'granted') return null;

  const registration = await registerServiceWorker();
  if (!registration) return null;

  try {
    return await subscribe(registration);
  } catch (e) {
    console.error('No se pudo restaurar la suscripción push:', e);
    return null;
  }
}
