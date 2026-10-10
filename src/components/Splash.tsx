'use client';
import { useEffect, useState } from 'react';

// Pantalla de carga: la patita (logo) se dibuja y se va llenando según el progreso real de carga.
// Coreografía (CSS en globals.css, bloque "Splash"):
//   load → contorno dibujado en cascada + líquido con olas que sube con el progreso (con goteo para no parecer congelado)
//   pop  → anticipación, rebote con overshoot, onda expansiva y brillo
//   exit → la patita hace zoom "a través" de la pantalla y revela la isla

type Phase = 'load' | 'pop' | 'exit';

const TOES: [number, number, number, number, number][] = [
  [30, 52, 10, 12.5, -25], [48, 32, 10.5, 13.5, -8], [72, 32, 10.5, 13.5, 8], [90, 52, 10, 12.5, 25],
];
const PAD = 'M60 58C46 58 32 70 32 84C32 97 43 101 51 98C55 96.5 57 95 60 95C63 95 65 96.5 69 98C77 101 88 97 88 84C88 70 74 58 60 58Z';
const WAVE = 'M0 3Q15 0 30 3T60 3T90 3T120 3T150 3T180 3T210 3T240 3V140H0Z'; // periodo 60, se desplaza en bucle
const TOP = 14, BOTTOM = 103; // límites verticales de la patita en el viewBox

function Shapes() {
  return (
    <>
      {TOES.map(([cx, cy, rx, ry, r], i) => <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${r} ${cx} ${cy})`} />)}
      <path d={PAD} />
    </>
  );
}

export default function Splash({ progress, ready, status, onDone }: {
  progress: number; ready: boolean; status: string; onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('load');
  const [trickle, setTrickle] = useState(0.06);

  // Goteo asintótico: mientras se espera a la red el nivel sigue subiendo despacio (nunca pasa de 0.88).
  useEffect(() => {
    if (ready) return;
    const id = setInterval(() => setTrickle(t => t + (0.88 - t) * 0.05), 200);
    return () => clearInterval(id);
  }, [ready]);

  // Listo: deja terminar el llenado → pop → zoom de salida → desmontar.
  useEffect(() => {
    if (!ready) return;
    const t = [setTimeout(() => setPhase('pop'), 850), setTimeout(() => setPhase('exit'), 1500), setTimeout(onDone, 2250)];
    return () => t.forEach(clearTimeout);
  }, [ready, onDone]);

  const level = ready ? 1 : Math.min(0.9, Math.max(progress, trickle));
  const y = TOP + (1 - level) * (BOTTOM - TOP);

  return (
    <div className={`splash splash--${phase} fixed inset-0 z-50 flex flex-col items-center justify-center font-nunito`} role="status" aria-live="polite">
      <div className="splash-bg absolute inset-0" />
      <div className="splash-paw-wrap relative" style={{ width: 'clamp(7rem, 34vmin, 11rem)' }}>
        <span className="splash-ripple" />
        <svg viewBox="0 0 120 120" className="splash-paw relative block w-full h-auto overflow-visible" aria-hidden>
          <defs>
            <clipPath id="splash-clip"><Shapes /></clipPath>
            <linearGradient id="splash-shine-grad" x1="0" x2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.6" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="splash-empty-group"><Shapes /></g>
          <g clipPath="url(#splash-clip)">
            <g className="splash-level" style={{ transform: `translateY(${y}px)` }}>
              <path d={WAVE} className="splash-wave--back" />
              <path d={WAVE} className="splash-wave--front" />
              {[[40, 48, 0], [63, 58, 0.8], [82, 50, 1.6]].map(([cx, cy, d], i) => (
                <circle key={i} cx={cx} cy={cy} r={1.8} className="splash-bubble" style={{ animationDelay: `${d}s` }} />
              ))}
            </g>
            <g transform="skewX(-20)"><rect className="splash-shine" x="-60" y="0" width="36" height="120" fill="url(#splash-shine-grad)" /></g>
          </g>
          <g className="splash-outline-group">
            {TOES.map(([cx, cy, rx, ry, r], i) => (
              <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${r} ${cx} ${cy})`} pathLength={1}
                className="splash-outline" style={{ animationDelay: `${i * 90}ms` }} />
            ))}
            <path d={PAD} pathLength={1} className="splash-outline" style={{ animationDelay: '360ms' }} />
          </g>
        </svg>
      </div>
      <h1 className="splash-title relative mt-6 text-white font-black text-[clamp(1.75rem,7vmin,2.5rem)] leading-none">Pocky</h1>
      <p className="splash-status relative mt-2 text-white/55 font-bold text-sm text-center px-6">{status}</p>
    </div>
  );
}
