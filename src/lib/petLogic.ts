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
/** Noche (22:00–8:00): dormido no se despierta solo al llenar la energía, duerme hasta las 8. */
export const isNight = (now = Date.now()) => { const h = cancunHour(now); return h >= 22 || h < 8; };
/** Muy tarde (1:00–8:00): si nadie lo ha acostado, se duerme solo… y se levanta de malas. */
export const isVeryLate = (now = Date.now()) => { const h = cancunHour(now); return h >= 1 && h < 8; };
const GRUMPY_MS = 3 * 3600000; // de malas: hasta un mimo, o 3 h
const GRUMPY_HAPPINESS = 15;

export function getMood(s: PetData, now = Date.now()): PetMood {
  if (s.isAsleep) return 'sleeping';
  if (s.health < 30) return 'sick';
  if ((s.grumpyUntil ?? 0) > now) return 'grumpy';
  const avg = (s.hunger + s.happiness + s.cleanliness + s.energy) / 4;
  if (avg >= 80) return 'happy';
  if (avg >= 60) return 'neutral';
  if (avg >= 30) return 'sad';
  return 'sick';
}

export function getNeeds(s: PetData, now = Date.now()): PetNeed[] {
  const needs: PetNeed[] = [];
  if (s.health < SICK) // la primera: es la que dice en el bocadillo y la que se sugiere en el dock
    needs.push({ id: 'medicine', emoji: '🤒', urgency: 'critical', message: `¡${s.name} está enfermo!` });
  if (s.hunger < 30)
    needs.push({ id: 'hunger', emoji: '🍖', urgency: s.hunger < 15 ? 'critical' : 'high', message: s.hunger < 15 ? `¡${s.name} está muy hambri@!` : `${s.name} quiere comer` });
  if (s.cleanliness < 30)
    needs.push({ id: 'bath', emoji: '🛁', urgency: s.cleanliness < 15 ? 'critical' : 'high', message: `${s.name} necesita baño` });
  if (visiblePoops(s, now).length)
    needs.push({ id: 'poop', emoji: '💩', urgency: 'high', message: '¡Hay caca en la isla! 💩' });
  if (s.happiness < 30)
    needs.push({ id: 'play', emoji: '🎾', urgency: 'high', message: `${s.name} está aburrido/a` });
  if (!s.isAsleep && isNight(now)) // aviso a las 22:00: si a la 1 sigue despierto, mañana se levanta de malas
    needs.push({ id: 'sleep', emoji: '🌙', urgency: 'high', message: `${s.name} tiene sueño, ya es tarde` });
  else if (s.energy < 20 && !s.isAsleep)
    needs.push({ id: 'sleep', emoji: '😴', urgency: 'high', message: `${s.name} tiene sueño` });
  return needs;
}

// ----- Cacas: cada comida programa una 2 h después (máx. 3 en la isla); se limpian tocándolas -----
export const POOP_SPOTS = 5; // sitios: POOP_XZ en nav.ts
const POOP_AFTER = 2 * 3600000, POOP_MAX = 3;
const POOP_DIRT_PER_MIN = 0.05; // cada caca a la vista ensucia más deprisa

export const visiblePoops = (s: PetData, now = Date.now()) => (s.poops ?? []).filter(p => p.at <= now);

function schedulePoop(s: PetData, now: number): Partial<PetData> {
  const poops = s.poops ?? [], used = new Set(poops.map(p => p.spot)), seed = s.totalCaresGiven ?? 0;
  if (poops.length >= POOP_MAX) return {};
  // Sitio según el contador de cuidados (los dos móviles y el servidor llegan al mismo), sin repetir uno ocupado.
  const spot = Array.from({ length: POOP_SPOTS }, (_, i) => (seed + i) % POOP_SPOTS).find(i => !used.has(i))!;
  return { poops: [...poops, { at: now + POOP_AFTER, spot }] };
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
  cleanliness = clamp(cleanliness - mins * POOP_DIRT_PER_MIN * visiblePoops(s, now).length);

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

  // Noche: muy tarde y despierto → se duerme solo (salvo si lo acaban de despertar: está de malas, desvelado).
  // Dormido de noche no se despierta hasta las 8.
  const fellAlone = !s.isAsleep && isVeryLate(now) && !((s.grumpyUntil ?? 0) > now);
  const isAsleep = fellAlone || (s.isAsleep && (energy < 95 || isNight(now)));
  // Se despierta tras dormirse solo: dormió fatal → de malas (se queja hasta un mimo o 3 h).
  const wokeGrumpy = s.isAsleep && !isAsleep && !!s.sleptAlone;
  if (wokeGrumpy) happiness = clamp(happiness - GRUMPY_HAPPINESS);

  const lowCount = [hunger, happiness, cleanliness].filter(v => v < 20).length;
  health = lowCount >= 2
    ? clamp(health - mins * 0.5)
    : clamp(health + mins * 0.1);

  const night: Partial<PetData> = fellAlone ? { sleptAlone: true }
    : wokeGrumpy ? { sleptAlone: false, grumpyUntil: now + GRUMPY_MS, grumpyWhy: 'alone' } : {};
  const next = { ...s, hunger, happiness, cleanliness, energy, health, isAsleep, ...night };
  return {
    hunger, happiness, cleanliness, energy, health, isAsleep, ...night,
    lastUpdated: now,
    // La acción termina sola a su hora (también si se cerró la app a mitad): nadie tiene que cerrarla.
    activity: isAsleep ? 'sleeping' : now < until ? s.activity : 'idle',
    mood: getMood(next, now),
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

export type PetAction = 'feed' | 'treat' | 'bathe' | 'walk' | 'play' | 'medicine' | 'sleep' | 'wake' | 'cuddle' | 'clean';

// Mimos (tocar a Pocky): +3 de felicidad, como mucho uno cada 30 s. No cuentan como cuidado (ni racha ni accesorios).
export const CUDDLE_MS = 30000;
const CUDDLE_GAIN = 3;

type Stat = 'hunger' | 'happiness' | 'cleanliness' | 'energy' | 'health';
// fullAt: a partir de cuánto de `full` ya no quiere (por defecto FULL).
type Effect = { activity: PetActivity; ms: number; full: Stat; gain: Partial<Record<Stat, number>>; minEnergy?: number; fullAt?: number };

/** Salud por debajo de esto: enfermo (mocos, mareo, necesidad crítica). */
export const SICK = 30;
/** La medicina solo se puede dar (y el botón solo sale) con la salud por debajo de esto. */
export const MEDICINE_BELOW = 50;

// Cada acción dura `ms` y reparte `gain` poco a poco mientras dura (en applyTick), como dormir.
// La golosina dura menos pero da más: cae del cielo y Pocky va a por ella.
const ACTIONS: Record<Exclude<PetAction, 'sleep' | 'wake' | 'cuddle' | 'clean'>, Effect> = {
  feed:  { activity: 'eating',   ms: 20000, full: 'hunger',      gain: { hunger: 15, happiness: 5 } },
  treat: { activity: 'snacking', ms: 12000, full: 'hunger',      gain: { hunger: 25, happiness: 10 } },
  bathe: { activity: 'bathing',  ms: 20000, full: 'cleanliness', gain: { cleanliness: 40, health: 5 } },
  walk:  { activity: 'walking',  ms: 25000, full: 'happiness',   gain: { happiness: 20, energy: -10, health: 5, hunger: -5 }, minEnergy: 15 },
  play:  { activity: 'playing',  ms: 20000, full: 'happiness',   gain: { happiness: 15, energy: -8, hunger: -5 }, minEnergy: 10 },
  // Va al botiquín de la casa y se toma la medicina.
  medicine: { activity: 'healing', ms: 20000, full: 'health',    gain: { health: 40 }, fullAt: MEDICINE_BELOW },
};
const EFFECT: Partial<Record<PetActivity, Effect>> = Object.fromEntries(Object.values(ACTIONS).map(e => [e.activity, e]));

/** A partir de aquí "está lleno" y no quiere más de eso. */
export const FULL = 90;

/** No quiere hacerlo: ya está lleno de eso, o no tiene energía para moverse. */
export function refuses(s: PetData, a: PetAction, now = Date.now()): boolean {
  if (a === 'wake' || a === 'cuddle' || a === 'clean') return false;
  if (a === 'sleep') return s.energy >= FULL && !isNight(now); // de noche siempre se puede acostar
  const e = ACTIONS[a];
  return s[e.full] >= (e.fullAt ?? FULL) || s.energy < (e.minEnergy ?? 0);
}

const withMood = (s: PetData, now: number): PetData => ({ ...s, mood: getMood(s, now) });

/**
 * Aplica una acción sobre el estado, descontando antes el tiempo transcurrido. null = ahora no se puede.
 * Se usa igual en local (respuesta inmediata) y dentro de la transacción de Firestore (la que manda).
 * Las acciones no suman nada al empezar: lo van sumando los ticks hasta `activityUntil`.
 */
export function applyAction(s: PetData, a: PetAction, now = Date.now(), spot?: number): PetData | null {
  const r: PetData = { ...s, ...applyTick(s, now), lastUpdated: now };
  // Limpiar la caca de `spot` (la que se tocó): cuenta como cuidado; se puede aunque Pocky esté ocupado o dormido.
  if (a === 'clean') {
    const poops = r.poops ?? [], i = poops.findIndex(p => p.spot === spot && p.at <= now);
    return i < 0 ? null : withMood({ ...r, ...cared(r, now), poops: poops.filter((_, j) => j !== i) }, now);
  }
  // Despertar no regala energía: la que tiene es la que recuperó durmiendo (antes +30: dormir/despertar llenaba la barra).
  // De noche, despertarlo lo pone de malas ("¡Me despertaron!").
  if (a === 'wake') return !r.isAsleep ? null : withMood({
    ...r, isAsleep: false, activity: 'idle', sleptAlone: false,
    ...(isNight(now) && { grumpyUntil: now + GRUMPY_MS, grumpyWhy: 'woken' as const }),
  }, now);
  // Mimos: también mientras hace otra cosa (no la interrumpen); dormido no se entera. Se le pasa lo de malas.
  if (a === 'cuddle') return r.isAsleep || now - (r.lastCuddle ?? 0) < CUDDLE_MS ? null
    : withMood({ ...r, happiness: clamp(r.happiness + CUDDLE_GAIN), lastCuddle: now, grumpyUntil: 0 }, now);
  if (r.isAsleep || r.activity !== 'idle' || refuses(r, a, now)) return null;
  if (a === 'sleep') return withMood({ ...r, isAsleep: true, activity: 'sleeping', sleptAlone: false }, now);
  const e = ACTIONS[a];
  const poop = a === 'feed' || a === 'treat' ? schedulePoop(r, now) : {};
  return withMood({ ...r, ...cared(r, now), ...poop, activity: e.activity, activityUntil: now + e.ms }, now);
}

/** Un cuidado de verdad (no mimos ni dormir): suma al contador y a la racha. */
function cared(s: PetData, now: number): Partial<PetData> {
  const today = cancunDay(now), streak = s.streakDay === today ? s.streak ?? 1
    : s.streakDay === cancunDay(now - 86400000) ? (s.streak ?? 0) + 1 : 1; // Cancún no cambia de hora: 24 h = ayer
  return { totalCaresGiven: (s.totalCaresGiven ?? 0) + 1, streak, streakDay: today };
}

// ----- Avisar al otro: resumen de lo que hizo la pareja (lo manda el cron) -----
const CARE_NOUN: Record<string, string> = {
  feed: 'comida 🍖', treat: 'golosina 🍬', bathe: 'baño 🛁', walk: 'paseo 🌳', play: 'juego 🎮',
  medicine: 'medicina 💊', clean: 'limpieza 💩', sleep: 'a dormir 🌙', wake: 'despertar ☀️',
};
const list = (xs: string[]) => new Intl.ListFormat('es', { type: 'conjunction' }).format(xs); // "a, b y c"
const PARTNER_EVERY = 30 * 60000; // como mucho un resumen cada 30 min por móvil
const PARTNER_SETTLE = 5 * 60000; // espera a que acabe la tanda (dio de comer y a los 2 min lo bañó → un aviso)
const PARTNER_WINDOW = 6 * 3600000; // lo más viejo (p. ej. de anoche, en silencio) ya no se cuenta

/** Qué contarle al móvil `id` de lo que hizo el otro desde su último resumen. null = nada (o aún no toca). */
export function partnerSummary(s: PetData, id: string, now = Date.now()): { title: string; body: string } | null {
  const me = s.devices?.[id], seen = me?.partnerSeen ?? 0;
  if (now - seen < PARTNER_EVERY) return null;
  // Del otro: ni mías ni de otro móvil con mi mismo nombre (mi iPad). Sin mimos, que serían spam.
  const news = (s.log ?? []).filter(e => e.t > seen && now - e.t < PARTNER_WINDOW && e.by !== id && CARE_NOUN[e.a]
    && (!me?.name || s.devices?.[e.by]?.name !== me.name));
  if (!news.length || now - news[news.length - 1].t < PARTNER_SETTLE) return null;
  const who = list([...new Set(news.map(e => s.devices?.[e.by]?.name ?? 'Alguien'))]);
  return { title: `${who} cuidó a ${s.name}`, body: list([...new Set(news.map(e => CARE_NOUN[e.a]))]) };
}

/** Racha que se ve: si el último día con cuidado no fue hoy ni ayer, ya se perdió. */
export function currentStreak(s: PetData, now = Date.now()): number {
  return s.streakDay === cancunDay(now) || s.streakDay === cancunDay(now - 86400000) ? s.streak ?? 0 : 0;
}

/** Campos que escriben los clientes. Nunca nombre, createdAt ni tokens (así no se pisan entre móviles). */
export function syncedFields(s: PetData) {
  const { hunger, happiness, cleanliness, energy, health, mood, activity, isAsleep, lastUpdated, totalCaresGiven, activityUntil, lastCuddle, streak, streakDay,
    sleptAlone, grumpyUntil, grumpyWhy, poops } = s;
  return {
    hunger, happiness, cleanliness, energy, health, mood, activity, isAsleep, lastUpdated,
    totalCaresGiven: totalCaresGiven ?? 0, activityUntil: activityUntil ?? 0, lastCuddle: lastCuddle ?? 0,
    streak: streak ?? 0, streakDay: streakDay ?? '',
    sleptAlone: sleptAlone ?? false, grumpyUntil: grumpyUntil ?? 0, grumpyWhy: grumpyWhy ?? '', poops: poops ?? [],
  };
}
