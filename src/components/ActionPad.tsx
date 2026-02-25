'use client';

interface Action {
  id:       string;
  emoji:    string;
  label:    string;
  color:    string;
  onPress:  () => void;
  disabled?: boolean;
}

interface Props {
  actions:  Action[];
  isAsleep: boolean;
}

export default function ActionPad({ actions, isAsleep }: Props) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {actions.map((a) => {
        const off = a.disabled || (isAsleep && a.id !== 'wake');
        return (
          <button
            key={a.id}
            onClick={() => !off && a.onPress()}
            disabled={off}
            className={`
              flex flex-col items-center justify-center gap-1
              aspect-square rounded-2xl p-3 shadow-md
              text-white font-bold text-xs
              transition-all duration-150 active:scale-95
              ${a.color}
              ${off ? 'opacity-30 cursor-not-allowed' : 'hover:brightness-110 cursor-pointer'}
            `}
          >
            <span className="text-2xl">{a.emoji}</span>
            <span>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}
