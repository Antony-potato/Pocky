import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Evita inicializar múltiples veces en desarrollo (hot reload)
export const app: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

// Caché persistente: la PWA arranca con los últimos datos aunque no haya red.
export const db = initializeFirestore(app, { localCache: persistentLocalCache() });

/**
 * Sesión anónima: las reglas de Firestore exigen `request.auth` (sin sesión todo da PERMISSION_DENIED,
 * que es lo que hacía que la app pareciera "sin conexión"). Reutiliza la sesión guardada entre recargas.
 * Requiere Firebase Console → Authentication → Sign-in method → Anónimo activado.
 */
let authReady: Promise<unknown> | null = null;
export function ensureAuth() {
  authReady ??= signInAnonymously(getAuth(app)).catch(e => { authReady = null; throw e; });
  return authReady;
}
