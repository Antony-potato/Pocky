'use client';
import { create } from 'zustand';
import { deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, ensureAuth } from '@/lib/firebase';

// Isla de juegos: lo que comparten la escena 3D (pantalla del cine, máquinas) y la interfaz (cine y minijuegos).
/** Lo que se proyecta en el cine: lo ve todo el hogar. `url`: foto reducida (data:) o enlace a una imagen o vídeo. */
export type Cinema = { url: string; kind: 'image' | 'video'; by: string; at: number };
export type Spot = 'cine' | 'brick' | 'bounce' | 'run';

export const useIsland = create<{
  there: boolean; // Pocky está en la isla de juegos (lo escribe la escena)
  open: Spot | null; // qué hay abierto a pantalla completa
  cinema: Cinema | null;
  homeAsked: number; // sube cada vez que se le pide volver a casa
  goAsked: number; // sube cada vez que se le manda a la isla de juegos
}>(() => ({ there: false, open: null, cinema: null, homeAsked: 0, goAsked: 0 }));

// En un documento aparte y no en el de la mascota: ese se reescribe con cada acción y una foto pesa cientos de KB.
// ponytail: la foto va dentro del documento de Firestore (tope 1 MB), reducida en el móvil; los vídeos, solo por
// enlace. Para subir vídeos o fotos grandes: Firebase Storage (pide plan de pago).
const ref = (petId: string) => doc(db, 'pets', petId, 'extra', 'cinema');
export const CINEMA_MAX = 900_000; // caracteres de `url`; el mismo tope está en firestore.rules

export function listenCinema(petId: string) {
  let unsub = () => {}, stopped = false;
  ensureAuth().then(() => {
    if (!stopped) unsub = onSnapshot(ref(petId), s => useIsland.setState({ cinema: (s.data() as Cinema | undefined) ?? null }), e => console.warn('Cine:', e));
  });
  return () => { stopped = true; unsub(); useIsland.setState({ cinema: null }); };
}
export const setCinema = (petId: string, c: Cinema | null) => (c ? setDoc(ref(petId), c) : deleteDoc(ref(petId)));
