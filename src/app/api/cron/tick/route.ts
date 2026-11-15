import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { applyTick, cancunDay, cancunHour, currentStreak, getNeeds, isQuietHour, partnerSummary } from '@/lib/petLogic';
import { PetData } from '@/types/pet';
import { adminApp as getAdminApp } from '@/lib/admin';

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
    // Todos los hogares, uno tras otro; si uno falla, los demás siguen.
    // ponytail: en serie (≈1 transacción por mascota). Con cientos, repartir en tandas en paralelo o por shards.
    const refs = await getFirestore(getAdminApp()).collection('pets').listDocuments();
    const appUrl = new URL('/', req.url).href;
    let notified = 0;
    for (const ref of refs) notified += await tickPet(ref, appUrl).catch(e => { console.error(`[Cron] ${ref.id}:`, e); return 0; });
    return NextResponse.json({ success: true, pets: refs.length, notified });
  } catch (e) {
    console.error('[Cron] Error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** Degrada una mascota y manda sus avisos. Devuelve cuántas notificaciones salieron. */
async function tickPet(ref: DocumentReference, appUrl: string): Promise<number> {
    const adminApp = getAdminApp(), firestore = ref.firestore;

    // Transacción: si un móvil guarda una acción a la vez, Firestore reintenta en vez de pisarla.
    const res = await firestore.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const pet = snap.data() as PetData;
      const changes = applyTick(pet);
      if (Object.keys(changes).length > 0) tx.update(ref, { ...changes, lastSyncedBy: 'cron', updatedAt: new Date() });
      return { pet, changes };
    });
    if (!res) return 0;
    const { pet, changes } = res;
    if (Object.keys(changes).length === 0) return 0;
    const merged = { ...pet, ...changes } as PetData;

    // ----- Notificaciones (FCM: Chrome, Android y Safari/iPhone instalado) -----
    const now = Date.now();
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
      console.log(`[Cron] ${ref.id} FCM "${data.title}": ok ${r.successCount}, fallos ${r.failureCount}`);
    };

    // Necesidades: a los dos, con cooldown. De noche (Cancún) se espera: sale a las 8:00.
    const needs = getNeeds(merged);
    const cooldown = needs.some(n => n.urgency === 'critical') ? CRITICAL_COOLDOWN_MS : COOLDOWN_MS;
    if (!isQuietHour(now) && needs.length > 0 && now - (pet.lastNotificationSent ?? 0) > cooldown - SLACK_MS) {
      await send(everyone, { title: `¡${pet.name} te necesita!`, body: needs.map(n => n.message).join(' y ') }, cooldown);
      update.lastNotificationSent = now;
    }

    // Se levantó de malas porque nadie lo acostó (lo despierta este tick, a las 8): a los dos.
    if (changes.grumpyWhy === 'alone' && !isQuietHour(now))
      await send(everyone, { title: `😾 ${pet.name} se levantó de malas`, body: 'Nadie lo acostó anoche y durmió fatal. ¡Dale unos mimos!', tag: 'malas' }, 3 * HOUR);

    // Racha en peligro: desde las 20:00 (Cancún), si nadie lo ha cuidado hoy y la racha es de 2+ días. Una vez al día.
    const today = cancunDay(now), streak = currentStreak(pet, now);
    if (streak >= 2 && pet.streakDay !== today && pet.streakWarned !== today && cancunHour(now) >= 20 && !isQuietHour(now)) {
      await send(everyone, { title: `🔥 ¡La racha de ${streak} días se pierde hoy!`, body: `Nadie ha cuidado a ${pet.name} hoy. ¡Aún hay tiempo!`, tag: 'racha' }, 4 * HOUR);
      update.streakWarned = today;
    }

    // Avisar al otro: a cada móvil, resumen de lo que hizo su pareja (ver partnerSummary). De noche se espera.
    if (!isQuietHour(now)) for (const [id, d] of Object.entries(devices)) {
      const msg = d.token ? partnerSummary(pet, id, now) : null;
      if (!msg) continue;
      await send([d.token!], { ...msg, tag: 'pareja' }, 2 * HOUR);
      update[`devices.${id}.partnerSeen`] = now;
    }

    // Tokens muertos: fuera de la lista vieja y de su móvil (el móvil crea otro al abrir la app).
    if (dead.size) {
      if (legacy.some(t => dead.has(t))) update.fcmTokens = legacy.filter(t => !dead.has(t));
      for (const [id, d] of Object.entries(devices)) if (d.token && dead.has(d.token)) update[`devices.${id}.token`] = FieldValue.delete();
    }
    if (Object.keys(update).length) await ref.update(update);

    return notified;
}
