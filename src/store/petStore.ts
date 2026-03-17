'use client';
import { create } from 'zustand';
import { db } from '@/lib/firebase';
import { doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { PetData, PetActivity, PetMood, PetNeed } from '@/types/pet';
import { clamp, getMood, getNeeds, applyTick, DEFAULT_PET } from '@/lib/petLogic';

// ID único por dispositivo (persiste en localStorage)
function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = localStorage.getItem('pocky_device_id');
  if (!id) {
    id = `device_${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem('pocky_device_id', id);
  }
  return id;
}

const PET_DOC = 'pets/pocky';

interface PetStore extends PetData {
  needs:       PetNeed[];
  isConnected: boolean;

  // Acciones
  feed:        (type?: 'normal' | 'treat') => void;
  bathe:       () => void;
  walk:        () => void;
  play:        () => void;
  putToSleep:  () => void;
  wakeUp:      () => void;
  tick:        () => void;

  // Firebase
  sync:             (data: Partial<PetData>) => Promise<void>;
  startListening:   () => () => void;
  registerFCMToken: (token: string) => Promise<void>;
}

export const usePetStore = create<PetStore>((set, get) => ({
  ...DEFAULT_PET,
  needs:       [],
  isConnected: false,

  sync: async (data) => {
    try {
      await setDoc(doc(db, PET_DOC), {
        ...data,
        lastSyncedBy: getDeviceId(),
        updatedAt:    serverTimestamp(),
      }, { merge: true });
    } catch (e) { console.error('Sync error:', e); }
  },

  registerFCMToken: async (token: string) => {
    try {
      // Usar arrayUnion nativamente es mejor, 
      // pero por simplicidad de Zustand read/write lo agregamos a mano o con merge profundo
      const currentState = get();
      const currentTokens = currentState.fcmTokens || [];
      if (!currentTokens.includes(token)) {
        const newTokens = [...currentTokens, token];
        set({ fcmTokens: newTokens });
        await setDoc(doc(db, PET_DOC), { fcmTokens: newTokens }, { merge: true });
      }
    } catch (e) { console.error('Token sync error:', e); }
  },

  startListening: () => {
    const unsub = onSnapshot(doc(db, PET_DOC), (snap) => {
      if (!snap.exists()) {
        get().sync(DEFAULT_PET);
        return;
      }
      
      const data = snap.data() as PetData;
      
      // ¡AQUÍ ESTÁ LA CORRECCIÓN! 
      // Eliminamos la validación del deviceId. 
      // Ahora el dispositivo siempre acepta los datos reales de Firebase al instante, 
      // evitando el error de que todo se regrese a 100 al recargar la página.
      set({
        ...data,
        needs:       getNeeds(data),
        isConnected: true,
      });
      
    }, () => set({ isConnected: false }));
    
    return unsub;
  },

  feed: (type = 'normal') => {
    const s = get();
    if (s.isAsleep || s.activity !== 'idle') return;
    const hunger    = clamp(s.hunger + (type === 'treat' ? 25 : 15));
    const happiness = clamp(s.happiness + (type === 'treat' ? 10 : 5));
    const next = { activity: 'eating' as PetActivity, hunger, happiness, totalCaresGiven: s.totalCaresGiven + 1, lastUpdated: Date.now() };
    set(next);
    get().sync(next);
    setTimeout(() => {
      const ns = get();
      const back = { activity: 'idle' as PetActivity, mood: getMood(ns), needs: getNeeds(ns) };
      set(back);
      get().sync({ activity: 'idle', mood: getMood(ns) });
    }, 2500);
  },

  bathe: () => {
    const s = get();
    if (s.isAsleep || s.activity !== 'idle') return;
    const next = { activity: 'bathing' as PetActivity, cleanliness: clamp(s.cleanliness + 40), health: clamp(s.health + 5), totalCaresGiven: s.totalCaresGiven + 1, lastUpdated: Date.now() };
    set(next);
    get().sync(next);
    setTimeout(() => {
      const ns = get();
      set({ activity: 'idle', mood: getMood(ns), needs: getNeeds(ns) });
      get().sync({ activity: 'idle', mood: getMood(ns) });
    }, 3000);
  },

  walk: () => {
    const s = get();
    if (s.isAsleep || s.activity !== 'idle' || s.energy < 15) return;
    const next = { activity: 'walking' as PetActivity, happiness: clamp(s.happiness + 20), energy: clamp(s.energy - 10), health: clamp(s.health + 5), hunger: clamp(s.hunger - 5), totalCaresGiven: s.totalCaresGiven + 1, lastUpdated: Date.now() };
    set(next);
    get().sync(next);
    setTimeout(() => {
      const ns = get();
      set({ activity: 'idle', mood: getMood(ns), needs: getNeeds(ns) });
      get().sync({ activity: 'idle', mood: getMood(ns) });
    }, 4000);
  },

  play: () => {
    const s = get();
    if (s.isAsleep || s.activity !== 'idle' || s.energy < 10) return;
    const next = { activity: 'playing' as PetActivity, happiness: clamp(s.happiness + 15), energy: clamp(s.energy - 8), hunger: clamp(s.hunger - 5), totalCaresGiven: s.totalCaresGiven + 1, lastUpdated: Date.now() };
    set(next);
    get().sync(next);
    setTimeout(() => {
      const ns = get();
      set({ activity: 'idle', mood: getMood(ns), needs: getNeeds(ns) });
      get().sync({ activity: 'idle', mood: getMood(ns) });
    }, 3000);
  },

  putToSleep: () => {
    get().tick(); // Aplicamos degradación pendiente antes de dormir para no perderla
    const next = { 
      isAsleep: true, 
      activity: 'sleeping' as PetActivity, 
      mood: 'sleeping' as PetMood,
      lastUpdated: Date.now() // Reinicia el timer para calcular el descanso exacto desde ahora
    };
    set(next);
    get().sync(next);
  },

  wakeUp: () => {
    const s = get();
    const base = { isAsleep: false, activity: 'idle' as PetActivity, energy: clamp(s.energy + 30) };
    set(base);
    const ns = get();
    const full = { ...base, mood: getMood(ns), needs: getNeeds(ns) };
    set(full);
    get().sync({ ...base, mood: getMood(ns) });
  },

  tick: () => {
    const s = get();
    const changes = applyTick(s);
    if (Object.keys(changes).length === 0) return;
    const merged = { ...s, ...changes };
    // Solo actualizamos la UI local, NO sincronizamos a Firebase.
    // La degradación real la hace el Cron Job del servidor.
    // Esto previene que pestañas con datos viejos sobreescriban los reales.
    set({ ...changes, needs: getNeeds(merged as PetData) });
  },
}));