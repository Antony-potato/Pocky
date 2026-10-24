'use client';
import { X, Lock } from 'lucide-react';
import type { PetData } from '@/types/pet';
import { ACCESSORIES } from '@/lib/petLogic';
import { PILL } from './CircularStats';

/** Armario: los accesorios se desbloquean con cuidados; tocar uno se lo pone (o se lo quita si ya lo lleva). */
export default function Wardrobe({ pet, onWear, onClose }: { pet: PetData; onWear: (id: string) => void; onClose: () => void }) {
  const cares = pet.totalCaresGiven ?? 0;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        role="dialog" aria-label="Armario"
        className={`${PILL} rounded-3xl w-full max-w-sm max-h-[75svh] flex flex-col overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pl-5 pr-2 pt-2">
          <div>
            <h2 className="text-white font-black text-lg leading-tight">Armario</h2>
            <p className="text-white/50 text-xs font-bold">{cares} cuidados · se desbloquean cuidando a {pet.name}</p>
          </div>
          <button onClick={onClose} className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-transform" aria-label="Cerrar">
            <X size={20} color="#e5e7eb" strokeWidth={2.5} />
          </button>
        </div>
        <ul className="overflow-y-auto p-3 grid grid-cols-2 gap-2">
          {ACCESSORIES.map(it => {
            const open = cares >= it.cares, on = pet.outfit?.[it.slot] === it.id;
            return (
              <li key={it.id}>
                <button
                  disabled={!open}
                  onClick={() => onWear(it.id)}
                  aria-pressed={on}
                  className={`w-full h-full rounded-2xl px-2 py-3 flex flex-col items-center gap-1 transition-transform active:scale-95
                    ${on ? 'bg-[#ff9f43]/20 ring-2 ring-[#ff9f43]' : 'bg-white/[0.05]'} ${open ? '' : 'opacity-45'}`}
                >
                  <span className="text-3xl leading-none" aria-hidden>{it.emoji}</span>
                  <span className="text-white text-sm font-extrabold leading-tight text-center">{it.name}</span>
                  <span className={`text-xs font-bold flex items-center gap-1 ${on ? 'text-[#ff9f43]' : 'text-white/50'}`}>
                    {!open && <Lock size={11} aria-hidden />}
                    {!open ? `Faltan ${it.cares - cares}` : on ? 'Lo lleva puesto' : 'Ponérselo'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
