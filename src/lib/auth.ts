'use client';
import { getAuth, signInAnonymously, onAuthStateChanged, type Auth } from 'firebase/auth';
import { app } from '@/lib/firebase';

/**
 * Autenticación anónima.
 *
 * Antes no había ninguna: las reglas de Firestore permitían `read: if true`, así
 * que cualquiera que conociera el projectId (va en el bundle, como es normal)
 * podía leer el documento por la API REST. Eso exponía las suscripciones push
 * completas — endpoint + claves p256dh/auth — con las que se pueden enviar
 * notificaciones arbitrarias a los teléfonos sin pasar por la app.
 *
 * El UID anónimo persiste entre recargas y sustituye al viejo id aleatorio de
 * localStorage como identidad del dispositivo.
 *
 * ⚠️ Requiere activar Authentication > Sign-in method > Anonymous en la consola
 * de Firebase. Sin eso, signInAnonymously falla con `auth/operation-not-allowed`.
 */

let authPromise: Promise<string> | null = null;

function getAuthInstance(): Auth {
  return getAuth(app);
}

export function ensureAuth(): Promise<string> {
  if (authPromise) return authPromise;

  authPromise = new Promise<string>((resolve, reject) => {
    const auth = getAuthInstance();

    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsub();
          resolve(user.uid);
        }
      },
      (err) => { unsub(); reject(err); },
    );

    if (!auth.currentUser) {
      signInAnonymously(auth).catch((err) => { unsub(); reject(err); });
    }
  });

  // Si falla, permitimos reintentar en la siguiente llamada.
  authPromise.catch(() => { authPromise = null; });
  return authPromise;
}

/** UID actual, o null si la sesión aún no está lista. */
export function getUid(): string | null {
  return getAuthInstance().currentUser?.uid ?? null;
}
