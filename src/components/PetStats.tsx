'use client';

interface StatBarProps {
  emoji: string;
  label: string;
  value: number;
  color: string;
}

function StatBar({ emoji, label, value, color }: StatBarProps) {
  const isLow      = value < 20;
  const isMedium   = value < 40;
  const barColor   = isLow ? 'bg-red-400' : isMedium ? 'bg-orange-400' : color;
  const textColor  = isLow ? 'text-red-500 font-bold' : 'text-gray-500';

  return (
    <div className="flex items-center gap-2">
      <span className="text-lg w-6 text-center">{emoji}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className={`text-xs w-8 text-right ${textColor}`}>
        {Math.round(value)}%
      </span>
    </div>
  );
}

interface Props {
  hunger:      number;
  happiness:   number;
  cleanliness: number;
  energy:      number;
  health:      number;
}

export default function PetStats({ hunger, happiness, cleanliness, energy, health }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <StatBar emoji="🍖" label="Hambre"    value={hunger}      color="bg-orange-400" />
      <StatBar emoji="😊" label="Felicidad" value={happiness}   color="bg-green-400"   />
      <StatBar emoji="🫧" label="Limpieza"  value={cleanliness} color="bg-sky-400"    />
      <StatBar emoji="⚡" label="Energía"   value={energy}      color="bg-yellow-400" />
      <StatBar emoji="❤️" label="Salud"     value={health}      color="bg-red-400"    />
    </div>
  );
}
