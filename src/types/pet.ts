export type PetSpecies  = 'cat' | 'dog' | 'bunny' | 'hamster';
export type PetMood     = 'happy' | 'neutral' | 'sad' | 'sick' | 'sleeping' | 'excited';
export type PetActivity = 'idle' | 'eating' | 'snacking' | 'bathing' | 'walking' | 'playing' | 'sleeping';

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
  activityUntil?:  number;   // timestamp ms — cuándo termina la acción en curso
  isAsleep:        boolean;
  age:             number;
  createdAt:       number;   // timestamp ms — when pet was first created
  lastUpdated:          number;   // timestamp ms
  lastNotificationSent?: number;
  totalCaresGiven:      number;
  lastCuddle?:          number;   // último mimo que contó (máx. uno cada 30 s)
  lastSyncedBy:         string;
  fcmTokens?:           string[]; // Tokens FCM antiguos, sin dueño (los nuevos van en `devices`)
  devices?:             Record<string, Device>; // cada móvil, por su deviceId
  log?:                 LogEntry[]; // últimas acciones, para el historial (máx. 30)
}

export interface LogEntry {
  by: string; // deviceId de quien la hizo
  a:  string; // acción ('feed', 'bathe', …)
  t:  number; // timestamp ms
}

export interface Device {
  name?:  string; // "¿Cómo te llamas?" la primera vez que se abre
  token?: string; // token FCM de ese móvil
}
