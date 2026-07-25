#!/usr/bin/env node
/**
 * Migración del documento de Pocky al esquema con proyección.
 *
 *   node scripts/migrate.mjs             # migra conservando los stats actuales
 *   node scripts/migrate.mjs --reset     # migra reiniciando los stats a los valores por defecto
 *   node scripts/migrate.mjs --dry-run   # muestra qué haría, sin escribir
 *
 * Qué hace:
 *  1. Ancla los stats actuales como nueva base, con lastUpdated = ahora.
 *  2. Añade activityUntil / sleepStartedAt y libera cualquier actividad colgada.
 *  3. Elimina los campos derivados que el esquema viejo persistía por error
 *     (mood, age, needs, isConnected).
 *  4. Mueve fcmTokens[] / webPushSubscriptions[] a la subcolección
 *     `subscriptions`, un documento por dispositivo, y los borra del principal.
 *
 * Ejecutar UNA VEZ, en la misma ventana en que se despliega el código nuevo.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const DRY   = process.argv.includes('--dry-run');
const RESET = process.argv.includes('--reset');

// ---- Carga de .env.local (soporta valores entre comillas) -------------------
function loadEnv(file = '.env.local') {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    let [, key, value] = m;
    value = value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const DEFAULTS = {
  name: 'Pocky', species: 'bunny',
  hunger: 80, happiness: 70, cleanliness: 90, energy: 85, health: 100,
};

const required = ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Faltan variables de entorno: ${missing.join(', ')}`);
  process.exit(1);
}

initializeApp({
  credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db  = getFirestore();
const ref = db.doc('pets/pocky');

const clamp = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : fb);

const snap = await ref.get();
if (!snap.exists) {
  console.error('No existe pets/pocky — nada que migrar.');
  process.exit(1);
}

const old = snap.data();
const now = Date.now();

const next = {
  name:    typeof old.name === 'string' && old.name ? old.name : DEFAULTS.name,
  species: ['cat', 'dog', 'bunny', 'hamster'].includes(old.species) ? old.species : DEFAULTS.species,

  hunger:      RESET ? DEFAULTS.hunger      : clamp(old.hunger,      DEFAULTS.hunger),
  happiness:   RESET ? DEFAULTS.happiness   : clamp(old.happiness,   DEFAULTS.happiness),
  cleanliness: RESET ? DEFAULTS.cleanliness : clamp(old.cleanliness, DEFAULTS.cleanliness),
  energy:      RESET ? DEFAULTS.energy      : clamp(old.energy,      DEFAULTS.energy),
  health:      RESET ? DEFAULTS.health      : clamp(old.health,      DEFAULTS.health),

  isAsleep:       old.isAsleep === true,
  sleepStartedAt: old.isAsleep === true ? now : null,
  // Cualquier actividad que quedara colgada por el bug del setTimeout se libera.
  activity:       old.isAsleep === true ? 'sleeping' : 'idle',
  activityUntil:  0,

  createdAt:       typeof old.createdAt === 'number' ? old.createdAt : now,
  totalCaresGiven: typeof old.totalCaresGiven === 'number' ? old.totalCaresGiven : 0,
  lastSyncedBy:    'migration',
  lastUpdated:     FieldValue.serverTimestamp(),

  // Campos derivados que nunca debieron persistirse:
  mood:        FieldValue.delete(),
  age:         FieldValue.delete(),
  needs:       FieldValue.delete(),
  isConnected: FieldValue.delete(),
  // Los tokens pasan a la subcolección:
  fcmTokens:             FieldValue.delete(),
  webPushSubscriptions:  FieldValue.delete(),
};

// ---- Suscripciones push -> subcolección ------------------------------------
const subs = [];
for (const [i, token] of (old.fcmTokens ?? []).entries()) {
  if (typeof token === 'string' && token) {
    subs.push({ id: `migrated_fcm_${i}`, data: { type: 'fcm', token, deviceId: `migrated_fcm_${i}` } });
  }
}
for (const [i, subscription] of (old.webPushSubscriptions ?? []).entries()) {
  if (subscription?.endpoint) {
    subs.push({ id: `migrated_web_${i}`, data: { type: 'webpush', subscription, deviceId: `migrated_web_${i}` } });
  }
}

console.log('--- Estado actual ---');
console.log({
  hunger: old.hunger, happiness: old.happiness, cleanliness: old.cleanliness,
  energy: old.energy, health: old.health,
  isAsleep: old.isAsleep, activity: old.activity,
  fcmTokens: (old.fcmTokens ?? []).length,
  webPushSubscriptions: (old.webPushSubscriptions ?? []).length,
});
console.log('--- Nuevo estado base ---');
console.log({
  hunger: next.hunger, happiness: next.happiness, cleanliness: next.cleanliness,
  energy: next.energy, health: next.health,
  isAsleep: next.isAsleep, activity: next.activity, activityUntil: next.activityUntil,
});
console.log(`--- Suscripciones a migrar: ${subs.length} ---`);

if (DRY) {
  console.log('\n(dry-run: no se escribió nada)');
  process.exit(0);
}

const batch = db.batch();
batch.update(ref, next);
for (const s of subs) {
  batch.set(ref.collection('subscriptions').doc(s.id), { ...s.data, updatedAt: FieldValue.serverTimestamp() });
}
await batch.commit();

console.log('\n✅ Migración completada.');
if (!RESET && (next.hunger < 20 || next.happiness < 20)) {
  console.log('⚠️  Pocky quedó con stats muy bajos (herencia del cron diario).');
  console.log('   Si prefieres empezar de cero: node scripts/migrate.mjs --reset');
}
