'use client';
import { Utensils, Smile, Droplet, Zap, Heart } from 'lucide-react';

export const HUD_DARK = '#151a19';
// Píldora oscura flotante sobre la escena 3D (HUD, paneles).
export const PILL = 'bg-[#151a19]/90 backdrop-blur-md border border-white/[0.07] shadow-lg';
const R = 26, CIRC = 2 * Math.PI * R;
const ICON = 'w-[42%] h-[42%]';

type Stat = 'hunger' | 'happiness' | 'cleanliness' | 'energy' | 'health';

const STATS: { key: Stat; label: string; color: string; icon: React.ReactNode }[] = [
  { key: 'hunger', label: 'Hambre', color: '#ff9f43', icon: <Utensils className={ICON} strokeWidth={2.75} color="#ff9f43" /> },
  { key: 'happiness', label: 'Felicidad', color: '#3ddc84', icon: <Smile className="w-1/2 h-1/2" fill="#3ddc84" color={HUD_DARK} strokeWidth={2.25} /> },
  { key: 'cleanliness', label: 'Limpieza', color: '#38bdf8', icon: <Droplet className={ICON} fill="#38bdf8" color="#38bdf8" /> },
  { key: 'energy', label: 'Energía', color: '#fcd34d', icon: <Zap className={ICON} fill="#fcd34d" color="#fcd34d" /> },
  { key: 'health', label: 'Salud', color: '#ff5c7a', icon: <Heart className={ICON} fill="#ff5c7a" color="#ff5c7a" /> },
];

// Columna de anillos sin texto (el nombre va en aria-label / title).
export default function CircularStats(props: Record<Stat, number>) {
  return (
    <div className="flex flex-col gap-2.5">
      {STATS.map(s => {
        const v = props[s.key], low = v < 20;
        return (
          <div key={s.key} className="relative w-[var(--ring,2.25rem)] h-[var(--ring,2.25rem)]" role="img" aria-label={`${s.label}: ${Math.round(v)}%`} title={`${s.label}: ${Math.round(v)}%`}>
            <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="7" />
              <circle
                cx="32" cy="32" r={R} fill="none" stroke={low ? '#ef4444' : s.color} strokeWidth="7" strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - v / 100)} className="transition-all duration-700 ease-out"
              />
            </svg>
            <div className={`absolute inset-0 flex items-center justify-center ${low ? 'animate-pulse' : ''}`}>{s.icon}</div>
          </div>
        );
      })}
    </div>
  );
}
