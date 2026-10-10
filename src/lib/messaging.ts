import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app } from './firebase';

/**
 * Activa las notificaciones con Firebase Cloud Messaging (gratis; Chrome, Android y Safari/iPhone).
 * Llamar SOLO desde un gesto del usuario (botón 🔔): iOS lo exige.
 * Devuelve el token FCM, o un mensaje de error para mostrar.
 */
export async function requestNotificationPermission(): Promise<{ token: string } | { error: string }> {
  try {
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const installed = window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !installed)
      return { error: 'En iPhone primero añade Pocky a la pantalla de inicio (Compartir → Añadir a inicio) y ábrelo desde el icono.' };
    if (!('Notification' in window) || !(await isSupported()))
      return { error: 'Este navegador no soporta notificaciones push.' };

    if ((await Notification.requestPermission()) !== 'granted')
      return { error: 'Permiso de notificaciones denegado. Actívalo en los ajustes del navegador.' };

    // SW propio sin SDK: muestra cada push él mismo (ver public/firebase-messaging-sw.js).
    const serviceWorkerRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

    const token = await getToken(getMessaging(app), {
      serviceWorkerRegistration,
      // Clave de Firebase Console → Cloud Messaging → Certificados web push. Sin ella usa la de Firebase por defecto.
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || undefined,
    });
    return token ? { token } : { error: 'No se pudo obtener el token de notificaciones.' };
  } catch (e) {
    console.error('Error al activar notificaciones:', e);
    return { error: 'No se pudieron activar las notificaciones. Revisa los permisos de tu navegador.' };
  }
}
