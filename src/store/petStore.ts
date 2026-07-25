'use client';
import { create } from 'zustand';
import {
  doc, onSnapshot, runTransaction, serverTimestamp, increment,
  Transaction, DocumentReference,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { PetDoc, ProjectedPet } from '@/types/pet';
import {
  projectPet, toBase, applyDeltas, createDefaultPet,
  ACTIONS, PetActionId, SLEEP_MAX_ENERGY,
} from '@/lib/petLogic';
import { normalizeDoc, PET_DOC_PATH } from '@/lib/petDoc';
import { ensureAuth } from '@/lib/auth';

export type PendingAction = PetActionId | 'sleep' | 'wake';

type RejectReason = 'busy' | 'asleep' | 'tired' | 'not-asleep' | 'not-tired' | 'offline';

const REJECT_MSG: Record<RejectReason, string> = {
  'busy':      'Pocky está ocupado ahora mismo',
  'asleep':    'Pocky está dormido',
  'tired':     'A Pocky le falta energía',
  'not-asleep':'Pocky ya está despierto',
  'not-tired': 'Pocky no tiene sueño todavía',
  'offline':   'Sin conexión — inténtalo de nuevo',
};

class ActionRejected extends Error {
  constructor(public reason: RejectReason) { super(reason); }
}

interface PetStore {
  /** Espejo del documento remoto. Solo lo escribe onSnapshot. */
  remote:  PetDoc | null;
  /** Reloj de pared. Solo lo escribe tickClock(). */
  now:     number;
  /** Conexión real con el servidor (no caché local). */
  online:  boolean;
  /** Acción en vuelo, para feedback inmediato en la UI. */
  pending: PendingAction | null;
  /** Mensaje efímero de error/aviso. */
  toast:   { id: number; text: string } | null;

  startListening: () => () => void;
  perform:  (id: PetActionId) => Promise<void>;
  sleep:    () => Promise<void>;
  wake:     () => Promise<void>;
  showToast:    (text: string) => void;
  dismissToast: () => void;
}

const petRef = () => doc(db, PET_DOC_PATH) as DocumentReference;

/** Avanza el reloj → provoca una nueva proyección. No muta ningún stat. */
export function tickClock() {
  usePetStore.setState({ now: Date.now() });
}

export const usePetStore = create<PetStore>((set) => {
  /**
   * Envuelve una mutación en una transacción de Firestore.
   *
   * La clave del refactor: lee el documento FRESCO dentro de la transacción y
   * valida contra su proyección, no contra la copia local. Dos acciones
   * simultáneas se serializan y ninguna se pierde.
   */
  async function mutate(
    pendingId: PendingAction,
    apply: (tx: Transaction, ref: DocumentReference, base: PetDoc, now: number, uid: string) => void,
  ) {
    set({ pending: pendingId });
    try {
      const uid = await ensureAuth();
      await runTransaction(db, async (tx) => {
        const ref = petRef();
        const snap = await tx.get(ref);
        const now = Date.now();

        if (!snap.exists()) {
          tx.set(ref, { ...createDefaultPet(now), lastUpdated: serverTimestamp() });
          return;
        }
        apply(tx, ref, normalizeDoc(snap.data(), now), now, uid);
      });
    } catch (e) {
      let text: string;
      if (e instanceof ActionRejected) {
        text = REJECT_MSG[e.reason];
      } else {
        const code = (e as { code?: string }).code;
        if (code === 'permission-denied')            text = 'Sin permiso para modificar a Pocky';
        else if (code === 'auth/operation-not-allowed') text = 'Falta activar el acceso anónimo en Firebase';
        else                                         text = REJECT_MSG.offline;
      }
      set({ toast: { id: Date.now(), text } });
    } finally {
      set({ pending: null });
    }
  }

  return {
    remote:  null,
    now:     Date.now(),
    online:  false,
    pending: null,
    toast:   null,

    startListening: () => onSnapshot(
      petRef(),
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists()) {
          // Creación idempotente: si dos dispositivos entran a la vez, la
          // transacción serializa y solo uno crea el documento.
          void runTransaction(db, async (tx) => {
            const ref = petRef();
            const s = await tx.get(ref);
            if (s.exists()) return;
            tx.set(ref, { ...createDefaultPet(), lastUpdated: serverTimestamp() });
          }).catch(() => { /* otro dispositivo lo creó primero */ });
          return;
        }
        set({
          remote: normalizeDoc(snap.data()),
          online: !snap.metadata.fromCache,
          // Proyectar ya mismo, sin esperar al siguiente tick del reloj.
          now:    Date.now(),
        });
      },
      () => set({ online: false }),
    ),

    perform: (id) => {
      const spec = ACTIONS[id];
      return mutate(id, (tx, ref, base, now, uid) => {
        const p = projectPet(base, now);
        if (p.isAsleep) throw new ActionRejected('asleep');
        if (p.activity !== 'idle') throw new ActionRejected('busy');
        if (spec.minEnergy !== undefined && p.energy < spec.minEnergy) {
          throw new ActionRejected('tired');
        }

        tx.update(ref, {
          ...toBase(applyDeltas(p, spec.deltas)),
          activity:        spec.activity,
          activityUntil:   now + spec.durationMs,
          isAsleep:        false,
          sleepStartedAt:  null,
          lastUpdated:     serverTimestamp(),
          totalCaresGiven: increment(1),
          lastSyncedBy:    uid,
          lastCareBy:      uid,
          lastCareAt:      now,
        });
      });
    },

    sleep: () => mutate('sleep', (tx, ref, base, now, uid) => {
      const p = projectPet(base, now);
      if (p.isAsleep) throw new ActionRejected('asleep');
      if (p.activity !== 'idle') throw new ActionRejected('busy');
      if (p.energy >= SLEEP_MAX_ENERGY) throw new ActionRejected('not-tired');

      tx.update(ref, {
        ...toBase(p),
        isAsleep:       true,
        sleepStartedAt: now,
        activity:       'sleeping',
        activityUntil:  0,
        lastUpdated:    serverTimestamp(),
        lastSyncedBy:   uid,
      });
    }),

    /**
     * Despertar NO regala energía. La energía ganada ya está en la proyección
     * (RATES.sleepRegen por minuto realmente dormido). Este era el bug del
     * "de 0 a 40 sin que pase tiempo".
     */
    wake: () => mutate('wake', (tx, ref, base, now, uid) => {
      if (!base.isAsleep) throw new ActionRejected('not-asleep');
      const p = projectPet(base, now);

      tx.update(ref, {
        ...toBase(p),
        isAsleep:       false,
        sleepStartedAt: null,
        activity:       'idle',
        activityUntil:  0,
        lastUpdated:    serverTimestamp(),
        lastSyncedBy:   uid,
      });
    }),

    showToast:    (text) => set({ toast: { id: Date.now(), text } }),
    dismissToast: () => set({ toast: null }),
  };
});

/**
 * Memo de tamaño 1 sobre (remote, now).
 *
 * Sin esto el selector devolvería un objeto nuevo en cada llamada — `needs` es
 * siempre un array recién construido — y cualquier cambio del store (pending,
 * toast…) provocaría un re-render aunque la proyección fuera idéntica.
 */
let projectionCache: { remote: PetDoc | null; now: number; result: ProjectedPet | null } | null = null;

function projectMemo(remote: PetDoc | null, now: number): ProjectedPet | null {
  if (projectionCache && projectionCache.remote === remote && projectionCache.now === now) {
    return projectionCache.result;
  }
  const result = remote ? projectPet(remote, now) : null;
  projectionCache = { remote, now, result };
  return result;
}

/**
 * Única vía de lectura del estado de la mascota para la UI.
 * Devuelve null mientras no haya llegado el primer snapshot.
 */
export function useProjectedPet(): ProjectedPet | null {
  return usePetStore((s) => projectMemo(s.remote, s.now));
}
