export type PetSpecies  = 'cat' | 'dog' | 'bunny' | 'hamster';
export type PetMood     = 'happy' | 'neutral' | 'sad' | 'sick' | 'sleeping' | 'excited';
export type PetActivity = 'idle' | 'eating' | 'bathing' | 'walking' | 'playing' | 'sleeping';

export type NeedId = 'hunger' | 'bath' | 'play' | 'sleep' | 'health';

export interface PetNeed {
  id:      NeedId;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

/** Los cinco valores 0-100 que se degradan con el tiempo. */
export interface PetStats {
  hunger:      number;
  happiness:   number;
  cleanliness: number;
  energy:      number;
  health:      number;
}

/**
 * El documento tal como vive en Firestore.
 *
 * IMPORTANTE: los stats son valores BASE, válidos exactamente en `lastUpdated`.
 * Nunca representan "lo que se ve ahora": para eso está `projectPet()`.
 * Nada derivado (mood, needs, age) se persiste — se calcula al proyectar.
 */
export interface PetDoc extends PetStats {
  name:            string;
  species:         PetSpecies;
  isAsleep:        boolean;
  /** ms epoch en que empezó a dormir; null si está despierto. */
  sleepStartedAt:  number | null;
  /** Solo significa algo mientras `now < activityUntil`. */
  activity:        PetActivity;
  /** ms epoch en que la actividad expira. Reemplaza a los setTimeout. */
  activityUntil:   number;
  /** ms epoch de la última escritura. Se escribe con serverTimestamp(). */
  lastUpdated:     number;
  createdAt:       number;
  totalCaresGiven: number;
  lastSyncedBy:    string;
  /** Quién hizo el último cuidado y cuándo (para el feed "Ana cuidó a Pocky"). */
  lastCareBy?:     string;
  lastCareAt?:     number;
  lastNotificationSent?: number;
}

/** Lo que la UI consume: estado base proyectado al instante actual. */
export interface ProjectedPet extends PetStats {
  name:      string;
  species:   PetSpecies;
  isAsleep:  boolean;
  activity:  PetActivity;
  mood:      PetMood;
  needs:     PetNeed[];
  ageDays:   number;
  /** Minutos que lleva dormido; 0 si está despierto. */
  sleptMins: number;
  createdAt:       number;
  totalCaresGiven: number;
  lastCareBy?:     string;
  lastCareAt?:     number;
}
