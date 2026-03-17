'use client';

interface Action {
  id: string;
  emoji: string;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  // NEW: Link the button to the specific activity string (e.g., 'eating', 'bathing')
  activityId?: string;
}

interface Props {
  actions: Action[];
  isAsleep: boolean;
  // NEW: Pass the current activity from your store
  currentActivity: string;
}

export default function ActionPad({ actions, isAsleep, currentActivity }: Props) {
  // Pocky is busy if doing anything other than 'idle'
  const isBusy = currentActivity !== 'idle';

  return (
    <div className="grid grid-cols-3 gap-3">
      {actions.map((a) => {
        // Check if this specific button is the one currently active
        const isActive = currentActivity === a.activityId && currentActivity !== 'idle';

        // Disable the button if:
        // 1. Explicitly disabled via props
        // 2. Pet is asleep (and this isn't the wake button)
        // 3. Pet is busy doing ANOTHER action (prevents interrupting)
        const off = a.disabled || (isAsleep && a.id !== 'wake') || (isBusy && !isActive);

        // Determine the visual state classes
        let visualStateClasses = 'opacity-100 hover:brightness-110 cursor-pointer';
        if (isActive) {
          // Highlight the active button with a ring and keep it fully visible
          visualStateClasses = 'opacity-100 ring-4 ring-white/50 scale-95';
        } else if (off) {
          // Dim the button if it's disabled or if another action is in progress
          visualStateClasses = 'opacity-40 cursor-not-allowed';
        }

        return (
          <button
            key={a.id}
            onClick={() => !off && a.onPress()}
            disabled={off}
            className={`
              flex flex-col items-center justify-center gap-1
              aspect-square rounded-2xl p-3 shadow-md
              text-white font-bold text-xs
              transition-all duration-300 active:scale-95
              ${a.color}
              ${visualStateClasses}
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