import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { applyTick, getNeeds, isQuietHour } from '@/lib/petLogic';
import { PetData } from '@/types/pet';

// firebase-admin no funciona en edge: esta ruta se queda en el runtime de Node.
function getAdminApp() {
  if (!getApps().length) {
    return initializeApp({
      credential: cert({
        projectId:   process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getApps()[0];
}

const HOUR = 60 * 60 * 1000;
const COOLDOWN_MS = 4 * HOUR;          // máx. una notificación cada 4 h…
const CRITICAL_COOLDOWN_MS = 1 * HOUR; // …o cada hora si está muy mal (alguna necesidad 'critical')
const SLACK_MS = 5 * 60 * 1000;        // el cron no cae al segundo: sin margen "cada hora" serían 1 h 15
// mismatched-credential / invalid-argument: Apple rechaza la suscripción (p. ej. creada con otra clave VAPID).
// Nunca se recuperan; el móvil crea uno nuevo al abrir la app.
const DEAD_TOKEN = new Set([
  'messaging/invalid-registration-token', 'messaging/registration-token-not-registered',
  'messaging/mismatched-credential', 'messaging/invalid-argument',
]);

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const adminApp = getAdminApp();
    const firestore = getFirestore(adminApp);
    const ref = firestore.doc('pets/pocky');

    // Transacción: si un móvil guarda una acción a la vez, Firestore reintenta en vez de pisarla.
    const res = await firestore.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const pet = snap.data() as PetData;
      const changes = applyTick(pet);
      if (Object.keys(changes).length > 0) tx.update(ref, { ...changes, lastSyncedBy: 'cron', updatedAt: new Date() });
      return { pet, changes };
    });
    if (!res) return NextResponse.json({ message: 'No pet found' });
    const { pet, changes } = res;
    if (Object.keys(changes).length === 0) return NextResponse.json({ message: 'No changes needed' });
    const merged = { ...pet, ...changes } as PetData;

    // ----- Notificaciones (FCM: Chrome, Android y Safari/iPhone instalado) -----
    const now = Date.now();
    const appUrl = new URL('/', req.url).href;
    const devices = pet.devices ?? {};
    const legacy = pet.fcmTokens ?? [];
    const everyone = [...new Set([...Object.values(devices).flatMap(d => d.token ? [d.token] : []), ...legacy])];
    const update: Record<string, unknown> = {};
    const dead = new Set<string>();
    let notified = 0;

    // Solo `data`: la notificación la pinta siempre nuestro service worker (fiable en iOS, sin duplicados).
    const send = async (tokens: string[], data: Record<string, string>, ttlMs: number) => {
      if (!tokens.length) return;
      const r = await getMessaging(adminApp).sendEachForMulticast({
        tokens,
        data: { link: appUrl, ...data },
        // high: entrega inmediata aunque Android esté en reposo (si no, las acumula y llegan juntas).
        // TTL: si el móvil no la recibe a tiempo, se descarta en vez de llegar tarde.
        webpush: { headers: { Urgency: 'high', TTL: String(Math.round(ttlMs / 1000)) } },
      });
      notified += r.successCount;
      r.responses.forEach((x, i) => { if (DEAD_TOKEN.has(x.error?.code ?? '')) dead.add(tokens[i]); });
      console.log(`[Cron] FCM "${data.title}": ok ${r.successCount}, fallos ${r.failureCount}`);
    };

    // Necesidades: a los dos, con cooldown. De noche (Cancún) se espera: sale a las 8:00.
    const needs = getNeeds(merged);
    const cooldown = needs.some(n => n.urgency === 'critical') ? CRITICAL_COOLDOWN_MS : COOLDOWN_MS;
    if (!isQuietHour(now) && needs.length > 0 && now - (pet.lastNotificationSent ?? 0) > cooldown - SLACK_MS) {
      await send(everyone, { title: `¡${pet.name} te necesita!`, body: needs.map(n => n.message).join(' y ') }, cooldown);
      update.lastNotificationSent = now;
    }

    // Tokens muertos: fuera de la lista vieja y de su móvil (el móvil crea otro al abrir la app).
    if (dead.size) {
      if (legacy.some(t => dead.has(t))) update.fcmTokens = legacy.filter(t => !dead.has(t));
      for (const [id, d] of Object.entries(devices)) if (d.token && dead.has(d.token)) update[`devices.${id}.token`] = FieldValue.delete();
    }
    if (Object.keys(update).length) await ref.update(update);

    return NextResponse.json({ success: true, changes, notified });
  } catch (e) {
    console.error('[Cron] Error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
