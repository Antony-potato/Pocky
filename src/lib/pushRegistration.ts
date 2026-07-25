'use client';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { PET_DOC_PATH } from '@/lib/petDoc';
import { getDeviceId } from '@/lib/deviceId';

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
  const deviceId = getDeviceId();
  await setDoc(doc(db, SUBSCRIPTIONS_PATH, deviceId), {
    type: 'webpush',
    subscription,
    deviceId,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : '',
    updatedAt: serverTimestamp(),
  });
}
