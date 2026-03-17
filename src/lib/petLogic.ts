import { PetData, PetMood, PetNeed } from '@/types/pet';

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

// Calcula la degradación por tiempo transcurrido
export function applyTick(s: PetData, now = Date.now()): Partial<PetData> {
  const mins = (now - s.lastUpdated) / 60000;
  if (mins < 1) return {};

  let { hunger, happiness, cleanliness, energy, health } = s;

  if (!s.isAsleep) {
    // Velocidad a 1.3x más rápida que el original
    hunger      = clamp(hunger - mins * 0.13);   // 7.8 pts/hora 
    happiness   = clamp(happiness - mins * 0.195);// 11.7 pts/hora 
    cleanliness = clamp(cleanliness - mins * 0.13); // 7.8 pts/hora
    energy      = clamp(energy - mins * 0.156);   // 9.36 pts/hora 
  } else {
    energy = clamp(energy + mins * 0.39); // Velocidad recuperación 1.3x
    hunger = clamp(hunger - mins * 0.065); // Desgaste durmiendo 1.3x
  }

  const lowCount = [hunger, happiness, cleanliness].filter(v => v < 20).length;
  health = lowCount >= 2
    ? clamp(health - mins * 0.5)
    : clamp(health + mins * 0.1);

  const next = { ...s, hunger, happiness, cleanliness, energy, health, lastUpdated: now };
  return {
    hunger, happiness, cleanliness, energy, health,
    lastUpdated: now,
    isAsleep: energy >= 95 ? false : s.isAsleep,
    activity: energy >= 95 ? 'idle' : s.activity,
    mood:     getMood(next as PetData),
  };
}

export const DEFAULT_PET: PetData = {
  name:            'Pocky',
  species:         'bunny',
  hunger:          80,
  happiness:       70,
  cleanliness:     90,
  energy:          85,
  health:          100,
  mood:            'happy',
  activity:        'idle',
  isAsleep:        false,
  age:             0,
  createdAt:       Date.now(),
  lastUpdated:     Date.now(),
  totalCaresGiven: 0,
  lastSyncedBy:    '',
};

/** Calcula la edad en días a partir de la fecha de creación */
export function computeAge(createdAt: number): number {
  return Math.floor((Date.now() - createdAt) / 86400000);
}
