'use client';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { PET_DOC_PATH } from '@/lib/petDoc';
import { ensureAuth } from '@/lib/auth';

export const SUBSCRIPTIONS_PATH = `${PET_DOC_PATH}/subscriptions`;

/**
 * Guarda la suscripción push como UN DOCUMENTO POR DISPOSITIVO.
 *
 * El esquema anterior mantenía arrays (`fcmTokens`, `webPushSubscriptions`) en
 * el documento de la mascota y los reescribía enteros: en una app para dos
 * personas, el segundo registro borraba al primero. Con un documento por
 * dispositivo no hay nada que pisar.
 */
export async function savePushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  // El id del documento es el UID: las reglas exigen que coincidan, así que
  // nadie puede escribir la suscripción de otro dispositivo.
  const uid = await ensureAuth();
  await setDoc(doc(db, SUBSCRIPTIONS_PATH, uid), {
    type: 'webpush',
    subscription,
    deviceId: uid,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : '',
    updatedAt: serverTimestamp(),
  });
}
