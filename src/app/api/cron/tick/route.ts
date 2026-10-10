import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { applyTick, getNeeds } from '@/lib/petLogic';
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

const COOLDOWN_MS = 4 * 60 * 60 * 1000; // máx. una notificación cada 4 h
const DEAD_TOKEN = new Set(['messaging/invalid-registration-token', 'messaging/registration-token-not-registered']);

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

    // ----- Notificación (FCM: Chrome, Android y Safari/iPhone instalado) -----
    const needs = getNeeds(merged);
    const tokens = pet.fcmTokens ?? [];
    const now = Date.now();
    const appUrl = new URL('/', req.url).href;
    let notified = 0;

    if (needs.length > 0 && tokens.length > 0 && now - (pet.lastNotificationSent ?? 0) > COOLDOWN_MS) {
      // Solo `data`: la notificación la pinta siempre nuestro service worker (fiable en iOS, sin duplicados).
      const res = await getMessaging(adminApp).sendEachForMulticast({
        tokens,
        data: { title: `¡${pet.name} te necesita!`, body: needs.map(n => n.message).join(' y '), link: appUrl },
        webpush: {
          // high: entrega inmediata aunque Android esté en reposo (si no, las acumula y llegan juntas).
          // TTL 4 h: si el móvil no la recibe a tiempo, se descarta en vez de llegar tarde.
          headers: { Urgency: 'high', TTL: String(COOLDOWN_MS / 1000) },
        },
      });
      notified = res.successCount;
      const alive = tokens.filter((_, i) => !DEAD_TOKEN.has(res.responses[i].error?.code ?? ''));
      await ref.update({ lastNotificationSent: now, ...(alive.length !== tokens.length && { fcmTokens: alive }) });
      console.log(`[Cron] FCM ok: ${res.successCount}, fallos: ${res.failureCount}, tokens borrados: ${tokens.length - alive.length}`);
    }

    return NextResponse.json({ success: true, changes, notified });
  } catch (e) {
    console.error('[Cron] Error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
