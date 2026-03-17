'use client';

interface CircularStatProps {
  icon: React.ReactNode;
  value: number;
  color: string;       // tailwind stroke color class
  strokeColor: string; // actual hex for SVG
  label: string;
}

function CircularStat({ icon, value, strokeColor, label }: CircularStatProps) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const isLow = value < 20;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative w-[60px] h-[60px]">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
          {/* Background ring */}
          <circle
            cx="32" cy="32" r={radius}
            fill="none"
            stroke="rgba(0,0,0,0.06)"
            strokeWidth="5"
          />
          {/* Progress ring */}
          <circle
            cx="32" cy="32" r={radius}
            fill="none"
            stroke={isLow ? '#ef4444' : strokeColor}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        {/* Center icon */}
        <div className={`absolute inset-0 flex items-center justify-center ${isLow ? 'animate-pulse' : ''}`}>
          {icon}
        </div>
      </div>
      <span className="text-[10px] font-inter font-medium text-gray-500 tracking-tight">{label}</span>
    </div>
  );
}

interface Props {
  hunger: number;
  happiness: number;
  cleanliness: number;
  energy: number;
  health: number;
}

export default function CircularStats({ hunger, happiness, cleanliness, energy, health }: Props) {
  return (
    <div className="flex items-center justify-center gap-3">
      <CircularStat
        icon={<span className="text-lg">🍖</span>}
        value={hunger}
        color="text-orange-400"
        strokeColor="#fb923c"
        label="Hambre"
      />
      <CircularStat
        icon={<span className="text-lg">😊</span>}
        value={happiness}
        color="text-green-400"
        strokeColor="#4ade80"
        label="Felicidad"
      />
      <CircularStat
        icon={<span className="text-lg">💧</span>}
        value={cleanliness}
        color="text-sky-400"
        strokeColor="#38bdf8"
        label="Limpieza"
      />
      <CircularStat
        icon={<span className="text-lg">⚡</span>}
        value={energy}
        color="text-yellow-400"
        strokeColor="#facc15"
        label="Energía"
      />
      <CircularStat
        icon={<span className="text-lg">❤️</span>}
        value={health}
        color="text-red-400"
        strokeColor="#f87171"
        label="Salud"
      />
    </div>
  );
}
