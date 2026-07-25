import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import webPush from 'web-push';
import { projectPet, baseFromProjection } from '@/lib/petLogic';
import { normalizeDoc, PET_DOC_PATH } from '@/lib/petDoc';
import { PetNeed } from '@/types/pet';

// firebase-admin no es compatible con el edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Cooldown entre notificaciones push, para no spamear. */
const NOTIFICATION_COOLDOWN_MS = 4 * 60 * 60 * 1000;

function getAdminApp(): App {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

/**
 * Configuración VAPID perezosa y con guarda.
 *
 * Antes esto vivía a nivel de módulo con `|| ''`: si faltaba una variable,
 * `web-push` lanzaba al importar y se caía el endpoint entero — incluida la
 * degradación de stats, que no tiene nada que ver con las notificaciones.
 */
let webPushReady: boolean | null = null;
function ensureWebPush(): boolean {
  if (webPushReady !== null) return webPushReady;

  const publicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject    = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    console.warn('[Cron] VAPID incompleto — Web Push deshabilitado');
    webPushReady = false;
    return false;
  }
  try {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    webPushReady = true;
  } catch (e) {
    console.error('[Cron] VAPID inválido — Web Push deshabilitado:', e);
    webPushReady = false;
  }
  return webPushReady;
}

/** Prioriza la necesidad más urgente en lugar de concatenarlas todas. */
function buildNotification(needs: PetNeed[], name: string) {
  const sorted = [...needs].sort(
    (a, b) => (a.urgency === 'critical' ? 0 : 1) - (b.urgency === 'critical' ? 0 : 1),
  );
  const top  = sorted[0];
  const rest = sorted.length - 1;
  return {
    title: rest > 0 ? `${name} necesita ${sorted.length} cosas` : `¡${name} te necesita!`,
    body:  rest > 0 ? `${top.message} (+${rest} más)` : top.message,
  };
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const adminApp = getAdminApp();
    const db  = getFirestore(adminApp);
    const ref = db.doc(PET_DOC_PATH);
    const snap = await ref.get();

    if (!snap.exists) return NextResponse.json({ message: 'No pet found' });

    const now  = Date.now();
    const base = normalizeDoc(snap.data(), now);
    const p    = projectPet(base, now);

    // El estado proyectado pasa a ser el nuevo estado base.
    const update: Record<string, unknown> = {
      ...baseFromProjection(base, p),
      lastUpdated:  FieldValue.serverTimestamp(),
      lastSyncedBy: 'cron',
    };

    const needs = p.needs.filter(n => n.urgency === 'critical' || n.urgency === 'high');
    const cooldownOver = now - (base.lastNotificationSent ?? 0) > NOTIFICATION_COOLDOWN_MS;
    let sent = 0;

    if (needs.length > 0 && cooldownOver) {
      const subsSnap = await db.collection(`${PET_DOC_PATH}/subscriptions`).get();

      if (!subsSnap.empty) {
        const { title, body } = buildNotification(needs, base.name);

        const fcmDocs = subsSnap.docs.filter(d => d.get('type') === 'fcm');
        const webDocs = subsSnap.docs.filter(d => d.get('type') === 'webpush');

        // ===== FCM (Chrome / Android) =====
        if (fcmDocs.length > 0) {
          try {
            const tokens = fcmDocs.map(d => d.get('token') as string);
            const res = await getMessaging(adminApp).sendEachForMulticast({
              notification: { title, body },
              webpush: { fcmOptions: { link: '/' } },
              tokens,
            });
            sent += res.successCount;

            await Promise.all(res.responses.map((r, i) => {
              const code = r.error?.code;
              const gone = code === 'messaging/invalid-registration-token'
                        || code === 'messaging/registration-token-not-registered';
              return gone ? fcmDocs[i].ref.delete() : Promise.resolve();
            }));
          } catch (err) {
            console.error('[Cron] Error enviando FCM:', err);
          }
        }

        // ===== Web Push nativo (Safari / iOS) =====
        if (webDocs.length > 0 && ensureWebPush()) {
          const payload = JSON.stringify({ title, body, url: '/' });
          await Promise.all(webDocs.map(async (d) => {
            try {
              await webPush.sendNotification(d.get('subscription') as webPush.PushSubscription, payload);
              sent += 1;
            } catch (err) {
              const status = (err as { statusCode?: number }).statusCode;
              if (status === 404 || status === 410) {
                await d.ref.delete();
              } else {
                console.error('[Cron] Error enviando Web Push:', err);
              }
            }
          }));
        }

        if (sent > 0) update.lastNotificationSent = now;
      }
    }

    await ref.update(update);

    console.log(`[Cron] hunger=${p.hunger.toFixed(1)} happiness=${p.happiness.toFixed(1)} needs=${needs.length} push=${sent}`);
    return NextResponse.json({ success: true, needs: needs.length, push: sent });

  } catch (e) {
    console.error('[Cron] Error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
