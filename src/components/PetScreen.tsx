'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { usePetStore, useProjectedPet, PendingAction } from '@/store/petStore';
import { usePetSync } from '@/hooks/usePetSync';
import PetAvatar from './PetAvatar';
import CircularStats from './CircularStats';
import Toast from './Toast';
import { MOOD_MSG } from '@/lib/sprites';
import { ACTIONS, PetActionId, SLEEP_MAX_ENERGY } from '@/lib/petLogic';
import { getTimeBackground } from '@/lib/timeBackground';
import { getUid } from '@/lib/auth';
import { makeRng } from '@/lib/random';
import { usePush } from '@/hooks/usePush';
import { NeedId, PetActivity } from '@/types/pet';
import {
  Beef, Candy, ShowerHead, TreePalm, Gamepad2, Moon, Sun,
  Bell, BellOff, PawPrint, UtensilsCrossed, AlertTriangle, Droplets, HeartPulse,
} from 'lucide-react';

const ACTIVITY_LABEL: Partial<Record<PetActivity, { label: string; icon: React.ReactNode }>> = {
  eating:   { label: 'comiendo',   icon: <UtensilsCrossed size={14} className="inline" /> },
  bathing:  { label: 'bañándose',  icon: <ShowerHead size={14} className="inline" /> },
  walking:  { label: 'paseando',   icon: <TreePalm size={14} className="inline" /> },
  playing:  { label: 'jugando',    icon: <Gamepad2 size={14} className="inline" /> },
  sleeping: { label: 'durmiendo',  icon: <Moon size={14} className="inline" /> },
};

const NEED_ICONS: Record<NeedId, React.ReactNode> = {
  hunger: <Beef       size={14} className="text-orange-600" />,
  bath:   <Droplets   size={14} className="text-sky-600" />,
  play:   <Gamepad2   size={14} className="text-fuchsia-600" />,
  sleep:  <Moon       size={14} className="text-indigo-600" />,
  health: <HeartPulse size={14} className="text-red-600" />,
};

/** Metadatos de presentación de cada acción. La mecánica vive en ACTIONS. */
const ACTION_UI: Record<PetActionId, { icon: React.ReactNode; gradient: string; label: string }> = {
  feed:  { icon: <Beef       size={22} />, gradient: 'from-orange-400 to-amber-300',  label: 'Alimentar' },
  treat: { icon: <Candy      size={22} />, gradient: 'from-rose-500 to-red-500',      label: 'Golosina' },
  bathe: { icon: <ShowerHead size={22} />, gradient: 'from-sky-400 to-cyan-300',      label: 'Bañar' },
  walk:  { icon: <TreePalm   size={22} />, gradient: 'from-emerald-400 to-green-300', label: 'Pasear' },
  play:  { icon: <Gamepad2   size={22} />, gradient: 'from-fuchsia-500 to-purple-500',label: 'Jugar' },
};

const ACTION_ORDER: PetActionId[] = ['feed', 'treat', 'bathe', 'walk', 'play'];

function vibrate(ms: number) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
}

function relativeTime(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1)  return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

function FloatingHearts({ count }: { count: number }) {
  // Posiciones deterministas por toque: dispersas pero estables entre renders.
  const hearts = useMemo(() => {
    const rng = makeRng(count * 7919);
    return Array.from({ length: Math.min(count * 3, 12) }, () => 30 + rng() * 40);
  }, [count]);

  if (count === 0) return null;
  return (
    <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
      {hearts.map((left, i) => (
        <span
          key={`${count}-${i}`}
          className="absolute text-lg animate-float-up"
          style={{ left: `${left}%`, bottom: '30%', animationDelay: `${i * 0.12}s`, opacity: 0 }}
        >
          ❤️
        </span>
      ))}
    </div>
  );
}

export default function PetScreen() {
  usePetSync();
  const push = usePush();

  const pet     = useProjectedPet();
  const pending = usePetStore(s => s.pending);
  const online  = usePetStore(s => s.online);
  const toast   = usePetStore(s => s.toast);

  const [isMounted, setIsMounted]   = useState(false);
  const [heartTaps, setHeartTaps]   = useState(0);
  useEffect(() => { setIsMounted(true); }, []);

  // Posiciones fijas: antes se recalculaban con Math.random() en cada render,
  // así que las estrellas saltaban cada vez que llegaba un snapshot.
  const stars = useMemo(() => {
    const rng = makeRng(20260725);
    return Array.from({ length: 30 }, () => ({
      top: rng() * 60,
      left: rng() * 100,
      delay: rng() * 3,
      opacity: 0.4 + rng() * 0.6,
      size: 1 + rng() * 2,
    }));
  }, []);

  const handlePetTap = useCallback(() => {
    setHeartTaps(prev => prev + 1);
    vibrate(30);
  }, []);

  const currentHour = isMounted ? new Date().getHours() : 10;
  const timeBg = getTimeBackground(pet?.isAsleep ? 22 : currentHour);

  if (!isMounted || !pet) {
    return (
      <main className="h-dvh bg-cream flex justify-center items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-amber-300 border-t-transparent rounded-full animate-spin" />
          <p className="font-outfit font-semibold text-gray-500 animate-pulse">Despertando a Pocky...</p>
        </div>
      </main>
    );
  }

  const busy = pet.activity !== 'idle';
  const sleepAction: PendingAction = pet.isAsleep ? 'wake' : 'sleep';
  const canSleep = !busy && pet.energy < SLEEP_MAX_ENERGY;

  const careByMe = !!pet.lastCareBy && pet.lastCareBy === getUid();

  return (
    <main
      className="h-dvh flex flex-col overflow-hidden relative transition-all duration-1000"
      style={timeBg.bgStyle}
    >
      {timeBg.isNight && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          {stars.map((s, i) => (
            <div
              key={i}
              className="absolute bg-white rounded-full animate-twinkle"
              style={{
                top: `${s.top}%`, left: `${s.left}%`,
                animationDelay: `${s.delay}s`, opacity: s.opacity,
                width: `${s.size}px`, height: `${s.size}px`,
              }}
            />
          ))}
        </div>
      )}

      <Toast toast={toast} onDismiss={usePetStore.getState().dismissToast} />

      {/* ===== TOP BAR ===== */}
      <div className="flex items-center justify-between px-4 pt-4 pb-1 z-10">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full shadow-sm ${online ? 'bg-green-400' : 'bg-amber-400'}`}
            title={online ? 'Conectado' : 'Sin conexión'}
          />
          <h1 className={`font-outfit font-bold text-lg ${timeBg.isNight ? 'text-white' : 'text-gray-800'}`}>
            {pet.name}
          </h1>
          <PawPrint size={14} className={timeBg.isNight ? 'text-white/40' : 'text-gray-400'} />
          <span className={`text-xs font-inter ${timeBg.isNight ? 'text-white/50' : 'text-gray-400'}`}>
            {pet.ageDays}d
          </span>
        </div>
        <button
          onClick={() => void push.enable()}
          aria-label={push.state === 'granted' ? 'Avisos activados' : 'Activar notificaciones'}
          className="bg-white/20 backdrop-blur-md rounded-full w-9 h-9 flex items-center justify-center shadow-sm active:scale-90 transition-transform border border-white/30"
        >
          {push.state === 'granted'
            ? <Bell size={16} className="text-green-400" />
            : <BellOff size={16} className={timeBg.isNight ? 'text-amber-300' : 'text-amber-500'} />}
        </button>
      </div>

      {/* ===== STATS ===== */}
      <div className="px-2 py-2 z-10">
        <CircularStats
          hunger={pet.hunger}
          happiness={pet.happiness}
          cleanliness={pet.cleanliness}
          energy={pet.energy}
          health={pet.health}
        />
      </div>

      {/* ===== PET AREA ===== */}
      <div className="flex-1 relative flex flex-col items-center justify-center px-4">
        <div className="relative mb-3 z-10">
          <div className={`rounded-2xl px-4 py-2 shadow-md border relative
            ${timeBg.isNight ? 'bg-white/10 backdrop-blur-md border-white/20' : 'bg-white/80 backdrop-blur-md border-amber-100'}`}>
            <p className={`font-caveat font-semibold text-base text-center whitespace-nowrap
              ${timeBg.isNight ? 'text-white' : 'text-gray-600'}`}>
              {MOOD_MSG[pet.mood] || '...'}
            </p>
            <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0
              border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent
              ${timeBg.isNight ? 'border-t-white/10' : 'border-t-white/80'}`} />
          </div>
        </div>

        <button
          type="button"
          onClick={handlePetTap}
          aria-label={`Acariciar a ${pet.name}`}
          className="relative cursor-pointer bg-transparent border-0 p-0"
        >
          <PetAvatar species={pet.species} mood={pet.mood} activity={pet.activity} />
          <FloatingHearts count={heartTaps} />
        </button>

        {/* Progreso de sueño: deja claro que despertarlo antes no regala energía */}
        {pet.isAsleep && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-indigo-500/80 backdrop-blur-sm rounded-full px-5 py-2 shadow-lg z-10 flex items-center gap-2">
            <Moon size={14} className="text-white" />
            <p className="text-white font-outfit font-bold text-sm whitespace-nowrap">
              Recuperando energía — {Math.round(pet.energy)}%
            </p>
          </div>
        )}

        {busy && !pet.isAsleep && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-purple/90 backdrop-blur-sm rounded-full px-5 py-2 shadow-lg z-10 flex items-center gap-2">
            {ACTIVITY_LABEL[pet.activity]?.icon}
            <p className="text-white font-outfit font-bold text-sm animate-pulse whitespace-nowrap">
              {pet.name} está {ACTIVITY_LABEL[pet.activity]?.label}...
            </p>
          </div>
        )}

        {pet.needs.length > 0 && (
          <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10 max-w-[55%] items-end">
            {pet.needs.map(n => (
              <div
                key={n.id}
                className={`rounded-full px-3 py-1 text-xs font-bold text-gray-800 shadow-md animate-pulse flex items-center gap-1.5
                  ${n.urgency === 'critical' ? 'bg-red-300' : 'bg-orange-200'}`}
              >
                {n.urgency === 'critical'
                  ? <AlertTriangle size={12} className="text-red-600" />
                  : NEED_ICONS[n.id]}
                {n.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== BOTTOM SHEET ===== */}
      <div className={`rounded-t-[2rem] shadow-[0_-4px_24px_rgba(0,0,0,0.1)] px-5 pt-4 pb-6 z-20
        ${timeBg.isNight ? 'bg-gray-900/80 backdrop-blur-xl border-t border-white/10' : 'bg-white/90 backdrop-blur-xl'}`}>
        <div className={`w-10 h-1 rounded-full mx-auto mb-3 ${timeBg.isNight ? 'bg-white/20' : 'bg-gray-300'}`} />

        <div className="flex items-baseline justify-between mb-3 px-1">
          <h2 className={`font-outfit font-bold text-sm ${timeBg.isNight ? 'text-white/70' : 'text-gray-600'}`}>
            Cuidados
          </h2>
          {pet.lastCareAt && (
            <span className={`text-[11px] font-inter ${timeBg.isNight ? 'text-white/40' : 'text-gray-400'}`}>
              🐾 {careByMe ? 'Lo cuidaste tú' : 'Te ganaron'} {relativeTime(pet.lastCareAt)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {ACTION_ORDER.map((id) => {
            const ui   = ACTION_UI[id];
            const spec = ACTIONS[id];
            const isActive = busy && !pet.isAsleep && pet.activity === spec.activity;
            const lacksEnergy = spec.minEnergy !== undefined && pet.energy < spec.minEnergy;
            const off = pet.isAsleep || busy || lacksEnergy || pending !== null;

            return (
              <ActionButton
                key={id}
                icon={ui.icon}
                label={ui.label}
                gradient={ui.gradient}
                active={isActive}
                disabled={off}
                loading={pending === id}
                isNight={timeBg.isNight}
                onPress={() => { vibrate(50); void usePetStore.getState().perform(id); }}
              />
            );
          })}

          <ActionButton
            icon={pet.isAsleep ? <Sun size={22} /> : <Moon size={22} />}
            label={pet.isAsleep ? 'Despertar' : 'Dormir'}
            gradient={pet.isAsleep ? 'from-yellow-400 to-amber-300' : 'from-indigo-400 to-violet-300'}
            active={pet.isAsleep}
            disabled={pending !== null || (pet.isAsleep ? false : !canSleep)}
            loading={pending === sleepAction}
            isNight={timeBg.isNight}
            onPress={() => {
              vibrate(50);
              const s = usePetStore.getState();
              void (pet.isAsleep ? s.wake() : s.sleep());
            }}
          />
        </div>
      </div>
    </main>
  );
}

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  gradient: string;
  active: boolean;
  disabled: boolean;
  loading: boolean;
  isNight: boolean;
  onPress: () => void;
}

function ActionButton({ icon, label, gradient, active, disabled, loading, isNight, onPress }: ActionButtonProps) {
  let styles: string;
  if (active) {
    styles = `bg-gradient-to-br ${gradient} text-white shadow-[0_0_15px_rgba(255,255,255,0.4)] ring-4 ring-white/50 scale-[0.98]`;
  } else if (disabled) {
    styles = isNight
      ? 'bg-white/5 text-white/20 cursor-not-allowed opacity-40'
      : 'bg-gray-50 text-gray-300 cursor-not-allowed opacity-50';
  } else {
    styles = `bg-gradient-to-br ${gradient} text-white shadow-md hover:shadow-lg hover:scale-[1.02] cursor-pointer`;
  }

  return (
    <button
      onClick={() => { if (!disabled) onPress(); }}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl p-3
                  font-outfit font-semibold text-xs transition-all duration-300 ${styles}
                  ${loading ? 'animate-pulse' : ''}`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
