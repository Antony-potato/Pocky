export type PetSpecies  = 'cat' | 'dog' | 'bunny' | 'hamster';
export type PetMood     = 'happy' | 'neutral' | 'sad' | 'sick' | 'sleeping' | 'excited';
export type PetActivity = 'idle' | 'eating' | 'bathing' | 'walking' | 'playing' | 'sleeping';

export interface PetNeed {
  id:      string;
  emoji:   string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

export interface PetData {
  name:            string;
  species:         PetSpecies;
  hunger:          number;   // 0-100
  happiness:       number;
  cleanliness:     number;
  energy:          number;
  health:          number;
  mood:            PetMood;
  activity:        PetActivity;
  isAsleep:        boolean;
  age:             number;
  createdAt:       number;   // timestamp ms — when pet was first created
  lastUpdated:          number;   // timestamp ms
  lastNotificationSent?: number;
  totalCaresGiven:      number;
  lastSyncedBy:         string;
  fcmTokens?:           string[]; // Tokens para notificaciones push (Chrome/Android)
  webPushSubscriptions?: object[]; // Suscripciones Web Push nativas (Safari/iOS)
}
