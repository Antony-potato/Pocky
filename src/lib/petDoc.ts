import { PetDoc, PetSpecies, PetActivity } from '@/types/pet';
import { createDefaultPet, clamp } from '@/lib/petLogic';

/** Ruta única del documento. No repetir este string en ningún otro sitio. */
export const PET_DOC_PATH = 'pets/pocky';

const SPECIES: readonly PetSpecies[] = ['cat', 'dog', 'bunny', 'hamster'];
const ACTIVITIES: readonly PetActivity[] = ['idle', 'eating', 'bathing', 'walking', 'playing', 'sleeping'];

/** Acepta Timestamp (cliente o admin), número o nada. */
function toMillis(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v) : fallback;
}

/**
 * Convierte lo que venga de Firestore en un PetDoc válido.
 *
 * Tolera el esquema anterior a la migración (lastUpdated numérico, sin
 * activityUntil/sleepStartedAt) y descarta los campos derivados que el modelo
 * viejo persistía por error (mood, age, needs, isConnected).
 */
export function normalizeDoc(data: unknown, now = Date.now()): PetDoc {
  const d = (data ?? {}) as Record<string, unknown>;
  const fallback = createDefaultPet(now);

  const species = SPECIES.includes(d.species as PetSpecies)
    ? (d.species as PetSpecies)
    : fallback.species;

  const activity = ACTIVITIES.includes(d.activity as PetActivity)
    ? (d.activity as PetActivity)
    : 'idle';

  // Documentos del esquema viejo no tienen activityUntil: la actividad que
  // hubiera quedado colgada expira de inmediato (arregla el deadlock heredado).
  const activityUntil = typeof d.activityUntil === 'number' ? d.activityUntil : 0;

  return {
    name:            typeof d.name === 'string' && d.name ? d.name : fallback.name,
    species,
    hunger:          num(d.hunger,      fallback.hunger),
    happiness:       num(d.happiness,   fallback.happiness),
    cleanliness:     num(d.cleanliness, fallback.cleanliness),
    energy:          num(d.energy,      fallback.energy),
    health:          num(d.health,      fallback.health),
    isAsleep:        d.isAsleep === true,
    sleepStartedAt:  typeof d.sleepStartedAt === 'number' ? d.sleepStartedAt : null,
    activity,
    activityUntil,
    lastUpdated:     toMillis(d.lastUpdated, now),
    createdAt:       typeof d.createdAt === 'number' ? d.createdAt : now,
    totalCaresGiven: typeof d.totalCaresGiven === 'number' ? d.totalCaresGiven : 0,
    lastSyncedBy:    typeof d.lastSyncedBy === 'string' ? d.lastSyncedBy : '',
    lastCareBy:      typeof d.lastCareBy === 'string' ? d.lastCareBy : undefined,
    lastCareAt:      typeof d.lastCareAt === 'number' ? d.lastCareAt : undefined,
    lastNotificationSent: typeof d.lastNotificationSent === 'number' ? d.lastNotificationSent : undefined,
  };
}
