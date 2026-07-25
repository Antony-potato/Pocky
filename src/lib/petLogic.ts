import { PetDoc, PetMood, PetNeed, PetStats, PetActivity, ProjectedPet } from '@/types/pet';

/**
 * Tasas de cambio por minuto. Todo el balanceo del juego vive aquí.
 *
 * Autonomía resultante desde 100: hambre ~37 h, felicidad ~30 h,
 * limpieza ~48 h, energía ~33 h. Un ciclo de sueño completo son ~2 h.
 */
export const RATES = {
  hunger:       0.045,
  happiness:    0.055,
  cleanliness:  0.035,
  energy:       0.050,
  /** Recuperación de energía mientras duerme. */
  sleepRegen:   0.800,
  /** El hambre sigue bajando durmiendo, pero mucho más lento. */
  hungerAsleep: 0.020,
  /** Pérdida de salud cuando 2+ stats están bajo 20. */
  healthDrop:   0.200,
  /** Recuperación de salud cuando todo está en orden. */
  healthRegen:  0.100,
} as const;

/** Nunca proyectamos más de 48 h: protege de relojes desviados y documentos antiguos. */
export const MAX_PROJECTION_MIN = 60 * 48;

export function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function clampStats(s: PetStats): PetStats {
  return {
    hunger:      clamp(s.hunger),
    happiness:   clamp(s.happiness),
    cleanliness: clamp(s.cleanliness),
    energy:      clamp(s.energy),
    health:      clamp(s.health),
  };
}

/**
 * Degrada (o regenera) los stats durante `mins` minutos en un único régimen.
 * Función pura y sin clamps intermedios más allá de los de cada stat.
 */
function decay(s: PetStats, mins: number, asleep: boolean): PetStats {
  if (mins <= 0) return clampStats(s);

  let { hunger, happiness, cleanliness, energy, health } = s;

  if (asleep) {
    energy = clamp(energy + mins * RATES.sleepRegen);
    hunger = clamp(hunger - mins * RATES.hungerAsleep);
    // Felicidad y limpieza se congelan mientras duerme.
  } else {
    hunger      = clamp(hunger      - mins * RATES.hunger);
    happiness   = clamp(happiness   - mins * RATES.happiness);
    cleanliness = clamp(cleanliness - mins * RATES.cleanliness);
    energy      = clamp(energy      - mins * RATES.energy);
  }

  // La salud depende de cómo estaban los stats al inicio del tramo.
  const lowCount = [s.hunger, s.happiness, s.cleanliness].filter(v => v < 20).length;
  health = clamp(health + mins * (lowCount >= 2 ? -RATES.healthDrop : RATES.healthRegen));

  return { hunger, happiness, cleanliness, energy, health };
}

/**
 * Proyecta el estado base al instante `now`.
 *
 * Es LA función central del sistema: la única fuente de verdad de lo que se ve.
 * Pura, determinista e idempotente — dos dispositivos con el mismo documento y
 * la misma hora obtienen exactamente el mismo resultado.
 */
export function projectPet(base: PetDoc, now: number): ProjectedPet {
  const elapsedMin = Math.min(
    Math.max((now - base.lastUpdated) / 60000, 0), // reloj atrasado -> 0, nunca negativo
    MAX_PROJECTION_MIN,
  );

  let stats: PetStats = clampStats(base);
  let isAsleep = base.isAsleep;

  if (isAsleep) {
    // Si la energía se llena a mitad del intervalo, Pocky se despierta solo y
    // el resto del tiempo transcurre en régimen despierto.
    const minsToFull = (100 - stats.energy) / RATES.sleepRegen;

    if (elapsedMin >= minsToFull) {
      stats = decay(stats, minsToFull, true);
      stats = decay(stats, elapsedMin - minsToFull, false);
      isAsleep = false;
    } else {
      stats = decay(stats, elapsedMin, true);
    }
  } else {
    stats = decay(stats, elapsedMin, false);
  }

  const activity: PetActivity = isAsleep
    ? 'sleeping'
    : (base.activityUntil > now ? base.activity : 'idle');

  const sleptMins = isAsleep && base.sleepStartedAt
    ? Math.max(0, (now - base.sleepStartedAt) / 60000)
    : 0;

  const mood  = getMood(stats, isAsleep);
  const needs = getNeeds(stats, isAsleep, base.name);

  return {
    ...stats,
    name:            base.name,
    species:         base.species,
    isAsleep,
    activity,
    mood,
    needs,
    ageDays:         Math.floor((now - base.createdAt) / 86_400_000),
    sleptMins,
    createdAt:       base.createdAt,
    totalCaresGiven: base.totalCaresGiven,
    lastCareBy:      base.lastCareBy,
    lastCareAt:      base.lastCareAt,
  };
}

/**
 * Extrae de una proyección los stats que se persisten como nueva base.
 * Todo lo demás (mood, needs, ageDays) es derivado y no se guarda.
 */
export function toBase(p: PetStats): PetStats {
  return clampStats(p);
}

/**
 * Campos a persistir para "anclar" una proyección como nuevo estado base,
 * sin aplicar ninguna acción. Lo usa el cron en cada tick.
 */
export function baseFromProjection(base: PetDoc, p: ProjectedPet) {
  const activityExpired = p.activity === 'idle' || p.activity === 'sleeping';
  return {
    ...toBase(p),
    isAsleep:       p.isAsleep,
    sleepStartedAt: p.isAsleep ? base.sleepStartedAt : null,
    activity:       p.activity,
    activityUntil:  activityExpired ? 0 : base.activityUntil,
  };
}

export function getMood(s: PetStats, isAsleep: boolean): PetMood {
  if (isAsleep) return 'sleeping';
  if (s.health < 30) return 'sick';
  const avg = (s.hunger + s.happiness + s.cleanliness + s.energy) / 4;
  if (avg >= 80) return 'happy';
  if (avg >= 60) return 'neutral';
  if (avg >= 30) return 'sad';
  return 'sick';
}

export function getNeeds(s: PetStats, isAsleep: boolean, name: string): PetNeed[] {
  const needs: PetNeed[] = [];

  // La salud es el único stat con consecuencia real: va primero.
  if (s.health < 40)
    needs.push({
      id: 'health',
      urgency: s.health < 20 ? 'critical' : 'high',
      message: s.health < 20 ? `¡${name} está enferm@!` : `${name} no se siente bien`,
    });

  if (s.hunger < 30)
    needs.push({
      id: 'hunger',
      urgency: s.hunger < 15 ? 'critical' : 'high',
      message: s.hunger < 15 ? `¡${name} está muy hambri@!` : `${name} quiere comer`,
    });

  if (s.cleanliness < 30)
    needs.push({
      id: 'bath',
      urgency: s.cleanliness < 15 ? 'critical' : 'high',
      message: `${name} necesita baño`,
    });

  if (s.happiness < 30)
    needs.push({
      id: 'play',
      urgency: s.happiness < 15 ? 'critical' : 'high',
      message: `${name} está aburrid@`,
    });

  if (s.energy < 20 && !isAsleep)
    needs.push({ id: 'sleep', urgency: 'high', message: `${name} tiene sueño` });

  return needs;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

export interface ActionSpec {
  activity:   PetActivity;
  durationMs: number;
  deltas:     Partial<PetStats>;
  /** Energía mínima requerida para poder ejecutarla. */
  minEnergy?: number;
}

/**
 * Tabla declarativa de acciones. Balancear el juego = editar estos números.
 * La comparte el cliente (transacciones) y cualquier validación del servidor.
 */
export type PetActionId = 'feed' | 'treat' | 'bathe' | 'walk' | 'play';

export const ACTIONS: Record<PetActionId, ActionSpec> = {
  feed:  { activity: 'eating',  durationMs: 2500, deltas: { hunger: +15, happiness: +5 } },
  treat: { activity: 'eating',  durationMs: 2500, deltas: { hunger: +25, happiness: +10 } },
  bathe: { activity: 'bathing', durationMs: 3000, deltas: { cleanliness: +40, health: +5 } },
  walk:  { activity: 'walking', durationMs: 4000, deltas: { happiness: +20, energy: -10, health: +5, hunger: -5 }, minEnergy: 15 },
  play:  { activity: 'playing', durationMs: 3000, deltas: { happiness: +15, energy: -8, hunger: -5 },              minEnergy: 10 },
};

/** Energía por debajo de la cual se puede dormir (evita dormir estando full). */
export const SLEEP_MAX_ENERGY = 90;

export function applyDeltas(s: PetStats, deltas: Partial<PetStats>): PetStats {
  return clampStats({
    hunger:      s.hunger      + (deltas.hunger      ?? 0),
    happiness:   s.happiness   + (deltas.happiness   ?? 0),
    cleanliness: s.cleanliness + (deltas.cleanliness ?? 0),
    energy:      s.energy      + (deltas.energy      ?? 0),
    health:      s.health      + (deltas.health      ?? 0),
  });
}

// ---------------------------------------------------------------------------
// Documento inicial
// ---------------------------------------------------------------------------

/**
 * Fábrica (no constante) — `createdAt`/`lastUpdated` deben ser del momento de
 * creación, no del momento en que se importó el módulo.
 */
export function createDefaultPet(now = Date.now()): PetDoc {
  return {
    name:            'Pocky',
    species:         'bunny',
    hunger:          80,
    happiness:       70,
    cleanliness:     90,
    energy:          85,
    health:          100,
    isAsleep:        false,
    sleepStartedAt:  null,
    activity:        'idle',
    activityUntil:   0,
    createdAt:       now,
    lastUpdated:     now,
    totalCaresGiven: 0,
    lastSyncedBy:    '',
  };
}
