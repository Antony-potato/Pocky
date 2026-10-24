'use client';
import { create } from 'zustand';
import { db, ensureAuth } from '@/lib/firebase';
import { doc, setDoc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { PetData, PetNeed } from '@/types/pet';
import { getNeeds, applyTick, applyAction, syncedFields, DEFAULT_PET, type PetAction } from '@/lib/petLogic';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = localStorage.getItem('pocky_device_id');
  if (!id) {
    id = `device_${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem('pocky_device_id', id);
  }
  return id;
}

const PET = doc(db, 'pets/pocky');
const LOG_MAX = 30;
let lastServer: PetData | null = null; // último estado confirmado por el servidor

interface PetStore extends PetData {
  needs: PetNeed[];
  /** Conectado Y con datos confirmados por el servidor: solo entonces se guardan cambios. */
  isConnected: boolean;
  /** Ya llegó al menos una vez el estado real del servidor (la pantalla de carga espera a esto). */
  loaded: boolean;
  /** Hay datos reales de Pocky (del servidor o de la caché del móvil), no solo los de por defecto. */
  hasData: boolean;
  /** Código del último error de sesión/permisos (p. ej. 'permission-denied'), para mostrarlo en el aviso. */
  syncError: string | null;

  /** `spot`: qué caca se limpia (solo para `clean`). */
  act: (a: PetAction, spot?: number) => void;
  tick: () => void;
  startListening: () => () => void;
  registerFCMToken: (token: string) => Promise<void>;
  setName: (name: string) => Promise<void>;
}

/** Escribe solo en `devices[este móvil]` (merge): no toca stats ni lo del otro móvil. */
async function saveDevice(data: { name?: string; token?: string }) {
  try {
    await ensureAuth();
    await setDoc(PET, { devices: { [getDeviceId()]: data } }, { merge: true });
  } catch (e) { console.error('Device sync error:', e); }
}

const view = (d: PetData) => ({ ...d, createdAt: d.createdAt ?? 0, needs: getNeeds(d) });

/**
 * Guarda con transacción: lee el estado REAL del servidor, aplica el cambio y escribe solo los campos de stats.
 * - Dos móviles a la vez no se pisan (antes ganaba el último en escribir su copia local entera).
 * - Sin conexión la transacción falla en vez de quedar en cola: lo jugado offline no se guarda.
 */
async function commit(change: (server: PetData) => PetData | null, logAs?: string): Promise<'saved' | 'rejected' | 'failed'> {
  try {
    return await runTransaction(db, async tx => {
      const snap = await tx.get(PET);
      const server = snap.data() as PetData | undefined;
      const next = server ? change(server) : null;
      if (!server || !next) return 'rejected';
      // Historial en la misma transacción, sobre el log del servidor: no se pierden las entradas del otro móvil.
      const log = logAs ? { log: [...(server.log ?? []), { by: getDeviceId(), a: logAs, t: Date.now() }].slice(-LOG_MAX) } : {};
      tx.update(PET, { ...syncedFields(next), ...log, lastSyncedBy: getDeviceId(), updatedAt: serverTimestamp() });
      return 'saved';
    });
  } catch (e) {
    console.warn('No se pudo guardar (¿sin conexión?):', e);
    return 'failed';
  }
}

// Solo en desarrollo: el store a mano desde la consola (window.pocky.setState({ health: 20 })) y en las capturas.
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') queueMicrotask(() => Object.assign(window, { pocky: usePetStore }));

export const usePetStore = create<PetStore>((set, get) => {
  // Si el servidor rechaza la acción (p. ej. tu pareja hizo otra a la vez), vuelve al estado real.
  const save = (change: (server: PetData) => PetData | null, logAs?: string) => {
    if (!get().isConnected) return; // sin conexión: solo local, a propósito
    commit(change, logAs).then(r => { if (r === 'rejected' && lastServer) { set(view(lastServer)); get().tick(); } });
  };

  return {
    ...DEFAULT_PET,
    createdAt: 0,
    needs: [],
    isConnected: false,
    loaded: false,
    hasData: false,
    syncError: null,

    act: (a, spot) => {
      const next = applyAction(get(), a, undefined, spot);
      if (!next) return;
      set({ ...next, needs: getNeeds(next) }); // respuesta inmediata en pantalla
      // Mimos al historial como mucho uno cada 10 min por móvil (si no, una tanda de toques lo llena).
      const me = getDeviceId();
      const spam = a === 'cuddle' && get().log?.some(e => e.a === 'cuddle' && e.by === me && Date.now() - e.t < 10 * 60000);
      save(server => applyAction(server, a, undefined, spot), spam ? undefined : a); // termina sola en `activityUntil` (applyTick), sin más escrituras
    },

    // Degradación local cada 20 s (cada 1 s durante una acción), solo para la pantalla. NUNCA escribe en la BD (eso es del cron y de las acciones).
    tick: () => {
      const s = get();
      const changes = applyTick(s);
      if (Object.keys(changes).length === 0) return;
      set({ ...changes, needs: getNeeds({ ...s, ...changes }) });
    },

    // Token por móvil (no en la lista común): así el cron sabe de quién es cada uno para avisar al otro.
    registerFCMToken: (token) => saveDevice({ token }),
    setName: (name) => {
      localStorage.setItem('pocky_name', name);
      return saveDevice({ name });
    },

    startListening: () => {
      let fromServer = false, prevJson = '';
      const connected = () => navigator.onLine && fromServer;
      // navigator.onLine da falsos positivos: "conectado" exige además datos frescos del servidor (fromCache = false).
      const onNet = () => set({ isConnected: connected() });
      window.addEventListener('online', onNet);
      window.addEventListener('offline', onNet);

      // Las reglas exigen sesión: primero sesión anónima, luego el listener.
      let unsub = () => {}, stopped = false;
      const fail = (e: { code?: string }) => { console.error('Firebase:', e); set({ isConnected: false, syncError: e.code ?? 'error' }); };
      ensureAuth().then(() => {
        if (stopped) return;
        unsub = onSnapshot(PET, { includeMetadataChanges: true }, (snap) => {
          fromServer = !snap.metadata.fromCache;
          if (!snap.exists()) {
            // Solo se crea si el SERVIDOR confirma que no existe. Antes bastaba con la caché vacía sin conexión,
            // y al reconectar machacaba a Pocky con los valores por defecto (y el contador de días volvía a 0).
            if (fromServer) setDoc(PET, { ...DEFAULT_PET, createdAt: Date.now(), lastUpdated: Date.now() });
            set({ isConnected: connected(), loaded: get().loaded || fromServer });
            return;
          }
          const data = snap.data() as PetData;
          if (fromServer) lastServer = data;
          const json = JSON.stringify(data);
          // Aplicar si cambiaron los datos o si acabamos de reconectar (descarta lo jugado sin conexión).
          // Si solo cambió la metadata (p. ej. se fue la conexión), no machacamos lo que se está jugando.
          if (json !== prevJson || (connected() && !get().isConnected)) {
            set(view(data));
            get().tick();
          }
          prevJson = json;
          set({ isConnected: connected(), loaded: get().loaded || fromServer, hasData: true, syncError: null });
        }, fail);
      }, fail);

      return () => {
        stopped = true;
        unsub();
        window.removeEventListener('online', onNet);
        window.removeEventListener('offline', onNet);
      };
    },
  };
});
