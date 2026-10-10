import type { PetData, PetMood, PetNeed } from '@/types/pet';

export function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

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

export function applyTick(s: PetData, now = Date.now()): Partial<PetData> {
  const mins = (now - s.lastUpdated) / 60000;
  if (mins < 1) return {};

  let { hunger, happiness, cleanliness, energy, health } = s;

  if (!s.isAsleep) {
    hunger = clamp(hunger - mins * 0.13);
    happiness = clamp(happiness - mins * 0.195);
    cleanliness = clamp(cleanliness - mins * 0.13);
    energy = clamp(energy - mins * 0.156);
  } else {
    energy = clamp(energy + mins * 0.39);
    hunger = clamp(hunger - mins * 0.065);
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
    // Las acciones duran segundos y aquí ha pasado >=1 min: cualquier actividad que no sea dormir está caducada
    // (p. ej. si se cerró la app antes del setTimeout que la devuelve a 'idle').
    activity: isAsleep ? 'sleeping' : 'idle',
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

// Cuánto dura cada acción antes de volver a 'idle' (dormir dura hasta despertar).
export const ACTION_MS: Partial<Record<PetAction, number>> = { feed: 2500, treat: 2500, bathe: 3000, walk: 4000, play: 3000 };

const withMood = (s: PetData): PetData => ({ ...s, mood: getMood(s) });

/**
 * Aplica una acción sobre el estado, descontando antes el tiempo transcurrido. null = ahora no se puede.
 * Se usa igual en local (respuesta inmediata) y dentro de la transacción de Firestore (la que manda).
 */
export function applyAction(s: PetData, a: PetAction, now = Date.now()): PetData | null {
  const r: PetData = { ...s, ...applyTick(s, now) };
  if (a === 'wake') return r.isAsleep ? withMood({ ...r, isAsleep: false, activity: 'idle', energy: clamp(r.energy + 30) }) : null;
  if (r.isAsleep || r.activity !== 'idle') return null;
  const cared = { ...r, totalCaresGiven: (r.totalCaresGiven ?? 0) + 1 };
  switch (a) {
    case 'sleep': return withMood({ ...r, isAsleep: true, activity: 'sleeping' });
    case 'feed': return withMood({ ...cared, activity: 'eating', hunger: clamp(r.hunger + 15), happiness: clamp(r.happiness + 5) });
    case 'treat': return withMood({ ...cared, activity: 'eating', hunger: clamp(r.hunger + 25), happiness: clamp(r.happiness + 10) });
    case 'bathe': return withMood({ ...cared, activity: 'bathing', cleanliness: clamp(r.cleanliness + 40), health: clamp(r.health + 5) });
    case 'walk': return r.energy < 15 ? null : withMood({ ...cared, activity: 'walking', happiness: clamp(r.happiness + 20), energy: clamp(r.energy - 10), health: clamp(r.health + 5), hunger: clamp(r.hunger - 5) });
    case 'play': return r.energy < 10 ? null : withMood({ ...cared, activity: 'playing', happiness: clamp(r.happiness + 15), energy: clamp(r.energy - 8), hunger: clamp(r.hunger - 5) });
  }
}

/** Fin de una acción: vuelve a 'idle' solo si sigue haciendo esa misma actividad. */
export function endActivity(s: PetData, activity: PetData['activity']): PetData | null {
  return s.activity === activity && !s.isAsleep ? withMood({ ...s, activity: 'idle' }) : null;
}

/** Campos que escriben los clientes. Nunca nombre, createdAt ni tokens (así no se pisan entre móviles). */
export function syncedFields(s: PetData) {
  const { hunger, happiness, cleanliness, energy, health, mood, activity, isAsleep, lastUpdated, totalCaresGiven } = s;
  return { hunger, happiness, cleanliness, energy, health, mood, activity, isAsleep, lastUpdated, totalCaresGiven: totalCaresGiven ?? 0 };
}
