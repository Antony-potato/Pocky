import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect } from 'firebase/auth';

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
 * Sesión con Google (Firebase Console → Authentication → Sign-in method → Google activado, y el dominio
 * desde el que se abre la app en "Dominios autorizados"). Las reglas de Firestore exigen ser miembro del hogar.
 */
export const auth = getAuth(app);
/** Espera a que Firebase restaure la sesión guardada (sin ella todo da PERMISSION_DENIED). */
export const ensureAuth = () => auth.authStateReady();

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); } catch (e) {
    // ponytail: sin ventana emergente (algunas PWA) se intenta por redirección; en Safari solo funciona si authDomain
    // es el mismo dominio que la app. Si hace falta, proxy de /__/auth en next.config.
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes((e as { code?: string }).code ?? '')) return signInWithRedirect(auth, provider);
    throw e;
  }
}

/** Llama a una ruta propia (/api/home, /api/admin) con el token de la sesión. Lanza Error con el mensaje del servidor. */
export async function api<T = Record<string, unknown>>(path: string, body: object): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'No se pudo conectar con el servidor.');
  return data;
}
