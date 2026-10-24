import type { PetActivity, PetData, PetMood, PetNeed } from '@/types/pet';

export function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

// Hora de Cancún (UTC−5 todo el año): la misma en los dos móviles y en el cron, que corre en UTC.
const TZ = 'America/Cancun';
const HOUR_FMT = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const cancunHour = (now = Date.now()) => Number(HOUR_FMT.format(now));
export const cancunDay = (now = Date.now()) => DAY_FMT.format(now); // '2026-10-24'
/** Silencio de notificaciones: de 23:00 a 8:00 (Cancún). */
export const isQuietHour = (now = Date.now()) => { const h = cancunHour(now); return h >= 23 || h < 8; };

export function getMood(s: PetData): PetMood {
  if (s.isAsleep) return 'sleeping';
  if (s.health < 30) return 'sick';
  const avg = (s.hunger + s.happiness + s.cleanliness + s.energy) / 4;
  if (avg >= 80) return 'happy';
  if (avg >= 60) return 'neutral';
  if (avg >= 30) return 'sad';
  return 'sick';
}

export function getNeeds(s: PetData): PetNeed[] {
  const needs: PetNeed[] = [];
  if (s.hunger < 30)
    needs.push({ id: 'hunger', emoji: '🍖', urgency: s.hunger < 15 ? 'critical' : 'high', message: s.hunger < 15 ? `¡${s.name} está muy hambri@!` : `${s.name} quiere comer` });
  if (s.cleanliness < 30)
    needs.push({ id: 'bath', emoji: '🛁', urgency: s.cleanliness < 15 ? 'critical' : 'high', message: `${s.name} necesita baño` });
  if (s.happiness < 30)
    needs.push({ id: 'play', emoji: '🎾', urgency: 'high', message: `${s.name} está aburrido/a` });
  if (s.energy < 20 && !s.isAsleep)
    needs.push({ id: 'sleep', emoji: '😴', urgency: 'high', message: `${s.name} tiene sueño` });
  return needs;
}

// Energía que recupera por minuto dormido: de 0 a 95 (se despierta solo) en ~30 min.
export const SLEEP_ENERGY_PER_MIN = 3;

export function applyTick(s: PetData, now = Date.now()): Partial<PetData> {
  const mins = (now - s.lastUpdated) / 60000;
  if (mins <= 0) return {};

  let { hunger, happiness, cleanliness, energy, health } = s;

  if (!s.isAsleep) {
    hunger = clamp(hunger - mins * 0.13);
    happiness = clamp(happiness - mins * 0.195);
    cleanliness = clamp(cleanliness - mins * 0.13);
    energy = clamp(energy - mins * 0.156);
  } else {
    energy = clamp(energy + mins * SLEEP_ENERGY_PER_MIN);
    hunger = clamp(hunger - mins * 0.065);
  }

  // Acción en curso: suma su efecto poco a poco, en proporción a lo que ha durado este tramo.
  const e = EFFECT[s.activity], until = s.activityUntil ?? 0;
  if (e && until > s.lastUpdated) {
    const f = (Math.min(now, until) - s.lastUpdated) / e.ms, g = e.gain;
    hunger = clamp(hunger + (g.hunger ?? 0) * f);
    happiness = clamp(happiness + (g.happiness ?? 0) * f);
    cleanliness = clamp(cleanliness + (g.cleanliness ?? 0) * f);
    energy = clamp(energy + (g.energy ?? 0) * f);
    health = clamp(health + (g.health ?? 0) * f);
  }

  const lowCount = [hunger, happiness, cleanliness].filter(v => v < 20).length;
  health = lowCount >= 2
    ? clamp(health - mins * 0.5)
    : clamp(health + mins * 0.1);

  const isAsleep = s.isAsleep && energy < 95;
  const next = { ...s, hunger, happiness, cleanliness, energy, health, isAsleep };
  return {
    hunger, happiness, cleanliness, energy, health, isAsleep,
    lastUpdated: now,
    // La acción termina sola a su hora (también si se cerró la app a mitad): nadie tiene que cerrarla.
    activity: isAsleep ? 'sleeping' : now < until ? s.activity : 'idle',
    mood: getMood(next),
  };
}

export const DEFAULT_PET: PetData = {
  name: 'Pocky',
  species: 'bunny',
  hunger: 80,
  happiness: 70,
  cleanliness: 90,
  energy: 85,
  health: 100,
  mood: 'happy',
  activity: 'idle',
  isAsleep: false,
  age: 0,
  createdAt: Date.now(),
  lastUpdated: Date.now(),
  totalCaresGiven: 0,
  lastSyncedBy: '',
};

// Días de calendario (hora local) desde que nació: si nació ayer a las 23:00, hoy ya cuenta 1.
export function computeAge(createdAt: number, now = Date.now()): number {
  const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  return Math.max(0, Math.round((day(now) - day(createdAt)) / 86400000));
}

export type PetAction = 'feed' | 'treat' | 'bathe' | 'walk' | 'play' | 'sleep' | 'wake';

type Stat = 'hunger' | 'happiness' | 'cleanliness' | 'energy' | 'health';
type Effect = { activity: PetActivity; ms: number; full: Stat; gain: Partial<Record<Stat, number>>; minEnergy?: number };

// Cada acción dura `ms` y reparte `gain` poco a poco mientras dura (en applyTick), como dormir.
// La golosina dura menos pero da más: cae del cielo y Pocky va a por ella.
const ACTIONS: Record<Exclude<PetAction, 'sleep' | 'wake'>, Effect> = {
  feed:  { activity: 'eating',   ms: 20000, full: 'hunger',      gain: { hunger: 15, happiness: 5 } },
  treat: { activity: 'snacking', ms: 12000, full: 'hunger',      gain: { hunger: 25, happiness: 10 } },
  bathe: { activity: 'bathing',  ms: 20000, full: 'cleanliness', gain: { cleanliness: 40, health: 5 } },
  walk:  { activity: 'walking',  ms: 25000, full: 'happiness',   gain: { happiness: 20, energy: -10, health: 5, hunger: -5 }, minEnergy: 15 },
  play:  { activity: 'playing',  ms: 20000, full: 'happiness',   gain: { happiness: 15, energy: -8, hunger: -5 }, minEnergy: 10 },
};
const EFFECT: Partial<Record<PetActivity, Effect>> = Object.fromEntries(Object.values(ACTIONS).map(e => [e.activity, e]));

/** A partir de aquí "está lleno" y no quiere más de eso. */
export const FULL = 90;

/** No quiere hacerlo: ya está lleno de eso, o no tiene energía para moverse. */
export function refuses(s: PetData, a: PetAction): boolean {
  if (a === 'wake') return false;
  if (a === 'sleep') return s.energy >= FULL;
  const e = ACTIONS[a];
  return s[e.full] >= FULL || s.energy < (e.minEnergy ?? 0);
}

const withMood = (s: PetData): PetData => ({ ...s, mood: getMood(s) });

/**
 * Aplica una acción sobre el estado, descontando antes el tiempo transcurrido. null = ahora no se puede.
 * Se usa igual en local (respuesta inmediata) y dentro de la transacción de Firestore (la que manda).
 * Las acciones no suman nada al empezar: lo van sumando los ticks hasta `activityUntil`.
 */
export function applyAction(s: PetData, a: PetAction, now = Date.now()): PetData | null {
  const r: PetData = { ...s, ...applyTick(s, now), lastUpdated: now };
  // Despertar no regala energía: la que tiene es la que recuperó durmiendo (antes +30: dormir/despertar llenaba la barra).
  if (a === 'wake') return r.isAsleep ? withMood({ ...r, isAsleep: false, activity: 'idle' }) : null;
  if (r.isAsleep || r.activity !== 'idle' || refuses(r, a)) return null;
  if (a === 'sleep') return withMood({ ...r, isAsleep: true, activity: 'sleeping' });
  const e = ACTIONS[a];
  return withMood({ ...r, activity: e.activity, activityUntil: now + e.ms, totalCaresGiven: (r.totalCaresGiven ?? 0) + 1 });
}

/** Campos que escriben los clientes. Nunca nombre, createdAt ni tokens (así no se pisan entre móviles). */
export function syncedFields(s: PetData) {
  const { hunger, happiness, cleanliness, energy, health, mood, activity, isAsleep, lastUpdated, totalCaresGiven, activityUntil } = s;
  return { hunger, happiness, cleanliness, energy, health, mood, activity, isAsleep, lastUpdated, totalCaresGiven: totalCaresGiven ?? 0, activityUntil: activityUntil ?? 0 };
}
