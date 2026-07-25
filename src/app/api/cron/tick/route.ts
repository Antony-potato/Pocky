import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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

/** Comparación en tiempo constante, tolerante a longitudes distintas. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Autoriza la llamada al tick.
 *
 * Preferido: cabecera `Authorization: Bearer <CRON_SECRET>`.
 * Alternativa: `?key=<CRON_SECRET>`, para schedulers externos que no permiten
 * cabeceras personalizadas. Es algo menos seguro — el secreto queda escrito en
 * los registros de acceso del scheduler y del hosting — así que usa la cabecera
 * siempre que el servicio la soporte.
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Sin secreto configurado no se autoriza a nadie (antes, con la variable sin
  // definir, bastaba con enviar literalmente "Bearer undefined").
  if (!secret) {
    console.error('[Cron] CRON_SECRET no está configurado.');
    return false;
  }

  const header = req.headers.get('authorization');
  if (header?.startsWith('Bearer ')) return safeEqual(header.slice(7), secret);

  const key = req.nextUrl.searchParams.get('key');
  if (key) return safeEqual(key, secret);

  return false;
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
  if (!isAuthorized(req)) {
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

      if (!subsSnap.empty && ensureWebPush()) {
        const { title, body } = buildNotification(needs, base.name);
        const payload = JSON.stringify({ title, body, url: '/' });

        await Promise.all(subsSnap.docs.map(async (d) => {
          const subscription = d.get('subscription') as webPush.PushSubscription | undefined;
          if (!subscription?.endpoint) return;

          try {
            await webPush.sendNotification(subscription, payload);
            sent += 1;
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            // 404/410: la suscripción caducó o el usuario desinstaló la PWA.
            if (status === 404 || status === 410) {
              await d.ref.delete();
              console.log('[Cron] Suscripción caducada eliminada.');
            } else {
              console.error('[Cron] Error enviando Web Push:', err);
            }
          }
        }));

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
