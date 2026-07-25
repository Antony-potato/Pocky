'use client';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { PET_DOC_PATH } from '@/lib/petDoc';
import { getDeviceId } from '@/lib/deviceId';

export const SUBSCRIPTIONS_PATH = `${PET_DOC_PATH}/subscriptions`;

export type PushRegistration =
  | { type: 'fcm';     token: string }
  | { type: 'webpush'; subscription: PushSubscriptionJSON };

/**
 * Guarda la suscripción push como UN DOCUMENTO POR DISPOSITIVO.
 *
 * El esquema anterior mantenía arrays (`fcmTokens`, `webPushSubscriptions`) en
 * el documento de la mascota y los reescribía enteros: en una app para dos
 * personas, el segundo registro borraba al primero. Con un documento por
 * dispositivo no hay nada que pisar.
 */
export async function savePushRegistration(reg: PushRegistration): Promise<void> {
  const deviceId = getDeviceId();
  const payload = reg.type === 'fcm'
    ? { type: 'fcm' as const,     token: reg.token }
    : { type: 'webpush' as const, subscription: reg.subscription };

  await setDoc(doc(db, SUBSCRIPTIONS_PATH, deviceId), {
    ...payload,
    deviceId,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : '',
    updatedAt: serverTimestamp(),
  });
}
