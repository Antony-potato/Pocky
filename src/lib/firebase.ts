import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Evita inicializar múltiples veces en desarrollo (hot reload)
export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * Caché persistente para el soporte offline de la PWA.
 * `persistentMultipleTabManager` es necesario para que una segunda pestaña no
 * falle al intentar obtener acceso exclusivo a la capa de persistencia.
 */
export const db: Firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
