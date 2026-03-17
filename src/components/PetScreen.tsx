'use client';
import { useEffect, useState, useCallback } from 'react';
import { usePetStore } from '@/store/petStore';
import PetAvatar from './PetAvatar';
import CircularStats from './CircularStats';
import { MOOD_MSG } from '@/lib/sprites';
import { requestNotificationPermission } from '@/lib/messaging';
import { computeAge } from '@/lib/petLogic';
import { getTimeBackground } from '@/lib/timeBackground';
import {
  Beef, Candy, ShowerHead, TreePalm, Gamepad2, Moon, Sun,
  Bell, PawPrint,
  UtensilsCrossed, AlertTriangle, Droplets
} from 'lucide-react';

const ACTIVITY_LABEL: Record<string, { label: string; icon: React.ReactNode }> = {
  eating: { label: 'comiendo', icon: <UtensilsCrossed size={14} className="inline" /> },
  bathing: { label: 'bañándose', icon: <ShowerHead size={14} className="inline" /> },
  walking: { label: 'paseando', icon: <TreePalm size={14} className="inline" /> },
  playing: { label: 'jugando', icon: <Gamepad2 size={14} className="inline" /> },
  sleeping: { label: 'durmiendo', icon: <Moon size={14} className="inline" /> },
};

const NEED_ICONS: Record<string, { icon: React.ReactNode }> = {
  hunger: { icon: <Beef size={14} className="text-orange-600" /> },
  bath: { icon: <Droplets size={14} className="text-sky-600" /> },
  play: { icon: <Gamepad2 size={14} className="text-fuchsia-600" /> },
  sleep: { icon: <Moon size={14} className="text-indigo-600" /> },
};

function FloatingHearts({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
      {Array.from({ length: Math.min(count * 3, 12) }).map((_, i) => (
        <span
          key={`${count}-${i}`}
          className="absolute text-lg animate-float-up"
          style={{
            left: `${30 + Math.random() * 40}%`,
            bottom: '30%',
            animationDelay: `${i * 0.12}s`,
            opacity: 0,
          }}
        >
          ❤️
        </span>
      ))}
    </div>
  );
}

export default function PetScreen() {
  const pet = usePetStore();
  const [isMounted, setIsMounted] = useState(false);
  const [heartTaps, setHeartTaps] = useState(0);
  const petAge = isMounted ? computeAge(pet.createdAt || Date.now()) : 0;
  const currentHour = isMounted ? new Date().getHours() : 10;
  const timeBg = getTimeBackground(pet.isAsleep ? 22 : currentHour);

  useEffect(() => { setIsMounted(true); }, []);

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    if (!result) {
      alert('No se pudieron activar las notificaciones. Revisa los permisos de tu navegador.');
      return;
    }
    if (result.type === 'fcm') {
      usePetStore.getState().registerFCMToken(result.token);
    } else {
      usePetStore.getState().registerWebPushSubscription(result.subscription);
    }
    alert('¡Notificaciones activadas! 🔔');
  };

  useEffect(() => {
    if (!isMounted) return;
    const unsub = pet.startListening();
    requestNotificationPermission().then(result => {
      if (result) {
        if (result.type === 'fcm') {
          usePetStore.getState().registerFCMToken(result.token);
        } else {
          usePetStore.getState().registerWebPushSubscription(result.subscription);
        }
      }
    });
    const interval = setInterval(() => { usePetStore.getState().tick(); }, 20000);
    return () => { unsub(); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted]);

  const handlePetTap = useCallback(() => {
    setHeartTaps(prev => prev + 1);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(30);
    }
  }, []);

  // NEW: Added `activityId` to map buttons to the store's current activity state
  // and changed `disabled` to `customDisabled` for specific stat requirements.
  const actions = [
    { id: 'feed', activityId: 'eating', icon: <Beef size={22} />, gradient: 'from-orange-400 to-amber-300', label: 'Alimentar', onPress: () => pet.feed('normal') },
    { id: 'treat', activityId: 'eating', icon: <Candy size={22} />, gradient: 'from-rose-500 to-red-500', label: 'Golosina', onPress: () => pet.feed('treat') },
    { id: 'bath', activityId: 'bathing', icon: <ShowerHead size={22} />, gradient: 'from-sky-400 to-cyan-300', label: 'Bañar', onPress: pet.bathe },
    { id: 'walk', activityId: 'walking', icon: <TreePalm size={22} />, gradient: 'from-emerald-400 to-green-300', label: 'Pasear', onPress: pet.walk, customDisabled: pet.energy < 15 },
    { id: 'play', activityId: 'playing', icon: <Gamepad2 size={22} />, gradient: 'from-fuchsia-500 to-purple-500', label: 'Jugar', onPress: pet.play, customDisabled: pet.energy < 10 },
    {
      id: pet.isAsleep ? 'wake' : 'sleep',
      activityId: 'sleeping',
      icon: pet.isAsleep ? <Sun size={22} /> : <Moon size={22} />,
      gradient: pet.isAsleep ? 'from-yellow-400 to-amber-300' : 'from-indigo-400 to-violet-300',
      label: pet.isAsleep ? 'Despertar' : 'Dormir',
      onPress: pet.isAsleep ? pet.wakeUp : pet.putToSleep,
    },
  ];

  if (!isMounted) {
    return (
      <main className="h-dvh bg-cream flex justify-center items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-amber-300 border-t-transparent rounded-full animate-spin" />
          <p className="font-outfit font-semibold text-gray-500 animate-pulse">Despertando a Pocky...</p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="h-dvh flex flex-col overflow-hidden relative transition-all duration-1000"
      style={timeBg.bgStyle}
    >
      {/* Night stars */}
      {timeBg.isNight && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          {Array.from({ length: 30 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-white rounded-full animate-twinkle"
              style={{
                top: `${Math.random() * 60}%`,
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 3}s`,
                opacity: 0.4 + Math.random() * 0.6,
                width: `${1 + Math.random() * 2}px`,
                height: `${1 + Math.random() * 2}px`,
              }}
            />
          ))}
        </div>
      )}

      {/* ===== TOP BAR ===== */}
      <div className="flex items-center justify-between px-4 pt-4 pb-1 z-10">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full shadow-sm ${pet.isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
          <h1 className={`font-outfit font-bold text-lg ${timeBg.isNight ? 'text-white' : 'text-gray-800'}`}>
            {pet.name}
          </h1>
          <PawPrint size={14} className={timeBg.isNight ? 'text-white/40' : 'text-gray-400'} />
          <span className={`text-xs font-inter ${timeBg.isNight ? 'text-white/50' : 'text-gray-400'}`}>{petAge}d</span>
        </div>
        <button
          onClick={handleEnableNotifications}
          className="bg-white/20 backdrop-blur-md rounded-full w-9 h-9 flex items-center justify-center shadow-sm active:scale-90 transition-transform border border-white/30"
          title="Activar notificaciones"
        >
          <Bell size={16} className={timeBg.isNight ? 'text-amber-300' : 'text-amber-500'} />
        </button>
      </div>

      {/* ===== STATS ROW ===== */}
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
        {/* Speech bubble */}
        <div className="relative mb-3 z-10">
          <div className={`rounded-2xl px-4 py-2 shadow-md border relative
            ${timeBg.isNight
              ? 'bg-white/10 backdrop-blur-md border-white/20'
              : 'bg-white/80 backdrop-blur-md border-amber-100'
            }`}>
            <p className={`font-caveat font-semibold text-base text-center whitespace-nowrap
              ${timeBg.isNight ? 'text-white' : 'text-gray-600'}`}>
              {MOOD_MSG[pet.mood] || '...'}
            </p>
            <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0
              border-l-[8px] border-r-[8px] border-t-[8px]
              border-l-transparent border-r-transparent
              ${timeBg.isNight ? 'border-t-white/10' : 'border-t-white/80'}`} />
          </div>
        </div>

        {/* Pet Avatar */}
        <div onClick={handlePetTap} className="cursor-pointer relative">
          <PetAvatar species={pet.species} mood={pet.mood} activity={pet.activity} />
          <FloatingHearts count={heartTaps} />
        </div>

        {/* Activity banner */}
        {pet.activity !== 'idle' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-purple/90 backdrop-blur-sm rounded-full px-5 py-2 shadow-lg z-10 flex items-center gap-2">
            {ACTIVITY_LABEL[pet.activity]?.icon}
            <p className="text-white font-outfit font-bold text-sm animate-pulse whitespace-nowrap">
              {pet.name} está {ACTIVITY_LABEL[pet.activity]?.label}...
            </p>
          </div>
        )}

        {/* Needs alerts */}
        {pet.needs && pet.needs.length > 0 && (
          <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10">
            {pet.needs.map(n => (
              <div
                key={n.id}
                className={`rounded-full px-3 py-1 text-xs font-bold text-gray-800 shadow-md animate-pulse flex items-center gap-1.5
                  ${n.urgency === 'critical' ? 'bg-red-300' :
                    n.urgency === 'high' ? 'bg-orange-200' : 'bg-yellow-100'}`}
              >
                {n.urgency === 'critical'
                  ? <AlertTriangle size={12} className="text-red-600" />
                  : NEED_ICONS[n.id]?.icon}
                {n.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== BOTTOM SHEET: Actions ===== */}
      <div className={`rounded-t-[2rem] shadow-[0_-4px_24px_rgba(0,0,0,0.1)] px-5 pt-4 pb-6 z-20
        ${timeBg.isNight
          ? 'bg-gray-900/80 backdrop-blur-xl border-t border-white/10'
          : 'bg-white/90 backdrop-blur-xl'
        }`}>
        <div className={`w-10 h-1 rounded-full mx-auto mb-3 ${timeBg.isNight ? 'bg-white/20' : 'bg-gray-300'}`} />
        <h2 className={`font-outfit font-bold text-sm mb-3 px-1 ${timeBg.isNight ? 'text-white/70' : 'text-gray-600'}`}>
          Cuidados
        </h2>
        <div className="grid grid-cols-3 gap-2.5">
          {actions.map((a) => {
            // NEW LOGIC: Determine button state
            const isBusy = pet.activity !== 'idle';
            const isActive = pet.activity === a.activityId && isBusy;

            // Disable if asleep (except wake), busy with ANOTHER task, or lacks energy
            const off = (pet.isAsleep && a.id !== 'wake') || (isBusy && !isActive) || a.customDisabled;

            // Determine dynamic styles based on activity state
            let buttonStyles = '';
            if (isActive) {
              buttonStyles = `bg-gradient-to-br ${a.gradient} text-white shadow-[0_0_15px_rgba(255,255,255,0.4)] ring-4 ring-white/50 scale-[0.98]`;
            } else if (off) {
              buttonStyles = timeBg.isNight
                ? 'bg-white/5 text-white/20 cursor-not-allowed opacity-40'
                : 'bg-gray-50 text-gray-300 cursor-not-allowed opacity-50';
            } else {
              buttonStyles = `bg-gradient-to-br ${a.gradient} text-white shadow-md hover:shadow-lg hover:scale-[1.02] cursor-pointer`;
            }

            return (
              <button
                key={a.id}
                onClick={() => {
                  if (off) return;
                  if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    navigator.vibrate(50);
                  }
                  a.onPress();
                }}
                disabled={off}
                className={`
                  flex flex-col items-center justify-center gap-1.5
                  rounded-2xl p-3
                  font-outfit font-semibold text-xs
                  transition-all duration-300
                  ${buttonStyles}
                `}
              >
                <span>{a.icon}</span>
                <span>{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>

    </main>
  );
}