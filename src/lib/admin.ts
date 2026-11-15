// Solo servidor (rutas /api): Admin SDK, que se salta las reglas de Firestore. No importar desde componentes.
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// firebase-admin no funciona en edge: las rutas que lo usan se quedan en el runtime de Node.
export function adminApp() {
  return getApps()[0] ?? initializeApp({
    credential: cert({
      projectId:   process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
export const adminDb = () => getFirestore(adminApp());

/**
 * Quién llama, según su token de Firebase (cabecera Authorization: Bearer). null = sin sesión de Google válida.
 * Admin = correo verificado que está en ADMIN_EMAILS (variable de entorno, separados por comas): la lista vive en el
 * servidor, nunca en el cliente ni en las reglas.
 * ponytail: un solo rol y un solo admin. Con más roles o admins que cambian → custom claims (`setCustomUserClaims`).
 */
export async function whoami(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return null;
  try {
    const t = await getAuth(adminApp()).verifyIdToken(token);
    if (t.firebase.sign_in_provider === 'anonymous') return null;
    const email = (t.email ?? '').toLowerCase();
    const admins = (process.env.ADMIN_EMAILS ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    return {
      uid: t.uid, email,
      name: String(t.name ?? email.split('@')[0] ?? 'Alguien').split(' ')[0].slice(0, 20),
      verified: t.email_verified === true,
      admin: t.email_verified === true && admins.includes(email),
    };
  } catch { return null; }
}

/** Error con mensaje para el usuario (los demás errores salen como 500 genérico). */
export class Oops extends Error {}
