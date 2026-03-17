'use client';
import { create } from 'zustand';
import { db } from '@/lib/firebase';
import { doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { PetData, PetActivity, PetMood, PetNeed } from '@/types/pet';
import { clamp, getMood, getNeeds, applyTick, DEFAULT_PET } from '@/lib/petLogic';

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
  needs: PetNeed[];
  isConnected: boolean;

  feed: (type?: 'normal' | 'treat') => void;
  bathe: () => void;
  walk: () => void;
  play: () => void;
  putToSleep: () => void;
  wakeUp: () => void;
  tick: () => void;

  sync: (data: Partial<PetData>) => Promise<void>;
  startListening: () => () => void;
  registerFCMToken: (token: string) => Promise<void>;
  registerWebPushSubscription: (sub: object) => Promise<void>;
}

export const usePetStore = create<PetStore>((set, get) => ({
  ...DEFAULT_PET,
  needs: [],
  isConnected: false,

  sync: async (data) => {
    try {
      // 1. Filtramos y eliminamos cualquier propiedad que sea una función
      const cleanData = Object.fromEntries(
        Object.entries(data).filter(([_, value]) => typeof value !== 'function')
      );

      // 2. Enviamos solo los datos puros a Firebase
      await setDoc(doc(db, PET_DOC), {
        ...cleanData,
        lastSyncedBy: getDeviceId(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.error('Sync error:', e);
    }
  },

  registerFCMToken: async (token: string) => {
    try {
      const currentState = get();
      const currentTokens = currentState.fcmTokens || [];
      if (!currentTokens.includes(token)) {
        const newTokens = [...currentTokens, token];
        set({ fcmTokens: newTokens });
        await setDoc(doc(db, PET_DOC), { fcmTokens: newTokens }, { merge: true });
      }
    } catch (e) { console.error('Token sync error:', e); }
  },

  registerWebPushSubscription: async (sub: object) => {
    try {
      const currentState = get();
      const currentSubs = (currentState.webPushSubscriptions || []) as PushSubscriptionJSON[];
      const subJSON = sub as PushSubscriptionJSON;
      const alreadyExists = currentSubs.some(
        (s: PushSubscriptionJSON) => s.endpoint === subJSON.endpoint
      );
      if (!alreadyExists) {
        const newSubs = [...currentSubs, subJSON];
        set({ webPushSubscriptions: newSubs });
        await setDoc(doc(db, PET_DOC), { webPushSubscriptions: newSubs }, { merge: true });
      }
    } catch (e) { console.error('WebPush sub sync error:', e); }
  },

  startListening: () => {
    const unsub = onSnapshot(doc(db, PET_DOC), (snap) => {
      if (!snap.exists()) {
        get().sync(DEFAULT_PET);
        return;
      }

      const data = snap.data() as PetData;

      set({
        ...data,
        needs: getNeeds(data),
        isConnected: true,
      });

    }, () => set({ isConnected: false }));

    return unsub;
  },

  feed: (type = 'normal') => {
    const s = get();
    if (s.isAsleep || s.activity !== 'idle') return;

    // CORRECCIÓN: Calcular estado real antes de aplicar la acción
    const realState = { ...s, ...applyTick(s) };

    const hunger = clamp(realState.hunger + (type === 'treat' ? 25 : 15));
    const happiness = clamp(realState.happiness + (type === 'treat' ? 10 : 5));

    const next = {
      ...realState,
      activity: 'eating' as PetActivity,
      hunger,
      happiness,
      totalCaresGiven: realState.totalCaresGiven + 1,
      lastUpdated: Date.now()
    };

    set({ ...next, mood: getMood(next as PetData), needs: getNeeds(next as PetData) });
    get().sync(next);

    setTimeout(() => {
      const ns = get();
      // CORRECCIÓN: Solo enviar el cambio de actividad, no recalcular stats
      set({ activity: 'idle', mood: getMood(ns), needs: getNeeds(ns) });
      get().sync({ activity: 'idle', mood: getMood(ns) });
    }, 2500);
  },

  bathe: () => {
    const s = get();
    if (s.isAsleep || s.activity !== 'idle') return;

    const realState = { ...s, ...applyTick(s) };
    const cleanliness = clamp(realState.cleanliness + 40);
    const health = clamp(realState.health + 5);

    const next = {
      ...realState,
      activity: 'bathing' as PetActivity,
      cleanliness,
      health,
      totalCaresGiven: realState.totalCaresGiven + 1,
      lastUpdated: Date.now()
    };

    set({ ...next, mood: getMood(next as PetData), needs: getNeeds(next as PetData) });
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

    const realState = { ...s, ...applyTick(s) };
    const happiness = clamp(realState.happiness + 20);
    const energy = clamp(realState.energy - 10);
    const health = clamp(realState.health + 5);
    const hunger = clamp(realState.hunger - 5);

    const next = {
      ...realState,
      activity: 'walking' as PetActivity,
      happiness, energy, health, hunger,
      totalCaresGiven: realState.totalCaresGiven + 1,
      lastUpdated: Date.now()
    };

    set({ ...next, mood: getMood(next as PetData), needs: getNeeds(next as PetData) });
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

    const realState = { ...s, ...applyTick(s) };
    const happiness = clamp(realState.happiness + 15);
    const energy = clamp(realState.energy - 8);
    const hunger = clamp(realState.hunger - 5);

    const next = {
      ...realState,
      activity: 'playing' as PetActivity,
      happiness, energy, hunger,
      totalCaresGiven: realState.totalCaresGiven + 1,
      lastUpdated: Date.now()
    };

    set({ ...next, mood: getMood(next as PetData), needs: getNeeds(next as PetData) });
    get().sync(next);

    setTimeout(() => {
      const ns = get();
      set({ activity: 'idle', mood: getMood(ns), needs: getNeeds(ns) });
      get().sync({ activity: 'idle', mood: getMood(ns) });
    }, 3000);
  },

  putToSleep: () => {

    const s = get();
    if (s.activity !== 'idle') return;
    // CORRECCIÓN: Obtener la degradación exacta antes de dormir e incluirla en el sync
    const realState = { ...s, ...applyTick(s) };

    const next = {
      ...realState,
      isAsleep: true,
      activity: 'sleeping' as PetActivity,
      mood: 'sleeping' as PetMood,
      lastUpdated: Date.now()
    };

    set({ ...next, needs: getNeeds(next as PetData) });
    get().sync(next);
  },

  wakeUp: () => {
    const s = get();
    const realState = { ...s, ...applyTick(s) };

    const energy = clamp(realState.energy + 30);
    const next = {
      ...realState,
      isAsleep: false,
      activity: 'idle' as PetActivity,
      energy,
      lastUpdated: Date.now()
    };

    set({ ...next, mood: getMood(next as PetData), needs: getNeeds(next as PetData) });
    get().sync({ ...next, mood: getMood(next as PetData) });
  },

  tick: () => {
    const s = get();
    const changes = applyTick(s);
    if (Object.keys(changes).length === 0) return;
    const merged = { ...s, ...changes };

    // Solo actualizamos la UI local. La BD sigue intacta.
    set({ ...changes, needs: getNeeds(merged as PetData) });
  },
}));