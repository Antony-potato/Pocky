'use client';
import { X } from 'lucide-react';
import type { PetData } from '@/types/pet';
import { PILL } from './CircularStats';

// Qué hizo cada uno: [emoji, 3.ª persona, 2.ª persona ("Tú")]. Con el nombre al final, sin género: "bañó a Pocky".
const VERB: Record<string, [string, string, string]> = {
  feed: ['🍖', 'dio de comer a', 'diste de comer a'],
  treat: ['🍬', 'dio una golosina a', 'diste una golosina a'],
  bathe: ['🛁', 'bañó a', 'bañaste a'],
  walk: ['🌳', 'sacó a pasear a', 'sacaste a pasear a'],
  play: ['🎮', 'jugó con', 'jugaste con'],
  medicine: ['💊', 'dio medicina a', 'diste medicina a'],
  sleep: ['🌙', 'acostó a', 'acostaste a'],
  wake: ['☀️', 'despertó a', 'despertaste a'],
  cuddle: ['❤️', 'dio mimos a', 'diste mimos a'],
  clean: ['💩', 'limpió una caca de', 'limpiaste una caca de'],
};

function ago(t: number, now: number) {
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  if (m < 24 * 60) return `hace ${Math.floor(m / 60)} h`;
  return new Date(t).toLocaleString('es-MX', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Historial compartido: quién cuidó a Pocky y cuándo (lo escriben las acciones, ver `commit` en petStore). */
export default function ActivityLog({ pet, me, onClose }: { pet: PetData; me: string; onClose: () => void }) {
  const now = Date.now();
  const entries = [...(pet.log ?? [])].reverse().filter(e => VERB[e.a]);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        role="dialog" aria-label="Historial"
        className={`${PILL} rounded-3xl w-full max-w-sm max-h-[70svh] flex flex-col overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pl-5 pr-2 pt-2 pb-1">
          <h2 className="text-white font-black text-lg">Historial</h2>
          <button onClick={onClose} className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-transform" aria-label="Cerrar">
            <X size={20} color="#e5e7eb" strokeWidth={2.5} />
          </button>
        </div>
        <ul className="overflow-y-auto px-3 pb-3 flex flex-col gap-1">
          {entries.length === 0 && <li className="text-white/60 text-sm px-2 py-3">Aún no hay nada. ¡Cuida a {pet.name}!</li>}
          {entries.map(e => {
            const [emoji, third, second] = VERB[e.a], mine = e.by === me;
            return (
              <li key={`${e.t}-${e.by}`} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5">
                <span className="text-xl leading-none" aria-hidden>{emoji}</span>
                <p className="flex-1 text-white/85 text-sm leading-snug">
                  <b className="text-white font-extrabold">{mine ? 'Tú' : pet.devices?.[e.by]?.name ?? 'Alguien'}</b> {mine ? second : third} {pet.name}
                </p>
                <span className="text-white/45 text-xs font-bold shrink-0">{ago(e.t, now)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
