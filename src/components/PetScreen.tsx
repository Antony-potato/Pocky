'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePetStore } from '@/store/petStore';
import CircularStats from './CircularStats';
import { requestNotificationPermission } from '@/lib/messaging';
import { computeAge } from '@/lib/petLogic';
import { getTimePhase } from '@/lib/timeBackground';
import {
  Beef, Candy, ShowerHead, TreePalm, Gamepad2, Moon, Sun,
  Bell, PawPrint,
  UtensilsCrossed, AlertTriangle, Droplets
} from 'lucide-react';

// Three.js solo en el cliente (usa WebGL y window).
const World = dynamic(() => import('./scene/World'), { ssr: false, loading: () => <Loading /> });

function Loading() {
  return (
    <div className="h-full flex justify-center items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 border-4 border-amber-300 border-t-transparent rounded-full animate-spin" />
        <p className="font-outfit font-semibold text-gray-500 animate-pulse">Despertando a Pocky...</p>
      </div>
    </div>
  );
}

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

export default function PetScreen() {
  const pet = usePetStore();
  const [isMounted, setIsMounted] = useState(false);
  const petAge = isMounted ? computeAge(pet.createdAt || Date.now()) : 0;
  const hour = pet.isAsleep ? 22 : isMounted ? new Date().getHours() : 10;
  const { isNight } = getTimePhase(hour);

  useEffect(() => { setIsMounted(true); }, []);

  // Las notificaciones se activan solo con el botón 🔔: iOS exige un gesto del usuario.
  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    if ('error' in result) return alert(result.error);
    await usePetStore.getState().registerFCMToken(result.token);
    alert('¡Notificaciones activadas! 🔔');
  };

  useEffect(() => {
    if (!isMounted) return;
    const unsub = pet.startListening();
    const interval = setInterval(() => { usePetStore.getState().tick(); }, 20000);
    return () => { unsub(); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted]);

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

  const glass = isNight ? 'bg-gray-900/55 border-white/10' : 'bg-white/70 border-white/60';

  return (
    <main className="h-dvh relative overflow-hidden bg-cream">
      {/* ===== ESCENA 3D (fondo a pantalla completa) ===== */}
      <div className="absolute inset-0 z-0">{isMounted ? <World hour={hour} /> : <Loading />}</div>

      {/* ===== HUD: no captura toques salvo en botones, para poder girar la isla ===== */}
      <div className="relative z-10 h-full flex flex-col pointer-events-none">
        <div className={`mx-3 mt-3 rounded-3xl border backdrop-blur-md shadow-sm px-3 pt-2 pb-2 ${glass}`}>
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full shadow-sm ${pet.isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
              <h1 className={`font-outfit font-bold text-lg ${isNight ? 'text-white' : 'text-gray-800'}`}>{pet.name}</h1>
              <PawPrint size={14} className={isNight ? 'text-white/40' : 'text-gray-400'} />
              <span className={`text-xs font-inter ${isNight ? 'text-white/50' : 'text-gray-400'}`}>{petAge}d</span>
            </div>
            <button
              onClick={handleEnableNotifications}
              className="pointer-events-auto bg-white/30 rounded-full w-9 h-9 flex items-center justify-center shadow-sm active:scale-90 transition-transform border border-white/40"
              title="Activar notificaciones"
            >
              <Bell size={16} className={isNight ? 'text-amber-300' : 'text-amber-500'} />
            </button>
          </div>
          <div className="pt-1">
            <CircularStats hunger={pet.hunger} happiness={pet.happiness} cleanliness={pet.cleanliness} energy={pet.energy} health={pet.health} />
          </div>
        </div>

        <div className="flex-1 relative">
          {pet.activity !== 'idle' && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-purple/90 backdrop-blur-sm rounded-full px-5 py-2 shadow-lg flex items-center gap-2 text-white">
              {ACTIVITY_LABEL[pet.activity]?.icon}
              <p className="font-outfit font-bold text-sm animate-pulse whitespace-nowrap">
                {pet.name} está {ACTIVITY_LABEL[pet.activity]?.label}...
              </p>
            </div>
          )}

          {pet.needs && pet.needs.length > 0 && (
            <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
              {pet.needs.map(n => (
                <div
                  key={n.id}
                  className={`rounded-full px-3 py-1 text-xs font-bold text-gray-800 shadow-md animate-pulse flex items-center gap-1.5
                    ${n.urgency === 'critical' ? 'bg-red-300' : n.urgency === 'high' ? 'bg-orange-200' : 'bg-yellow-100'}`}
                >
                  {n.urgency === 'critical' ? <AlertTriangle size={12} className="text-red-600" /> : NEED_ICONS[n.id]?.icon}
                  {n.message}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ===== BOTTOM SHEET: Acciones ===== */}
        <div className={`pointer-events-auto rounded-t-[2rem] shadow-[0_-4px_24px_rgba(0,0,0,0.1)] px-5 pt-4 pb-6
          ${isNight ? 'bg-gray-900/80 backdrop-blur-xl border-t border-white/10' : 'bg-white/90 backdrop-blur-xl'}`}>
          <div className={`w-10 h-1 rounded-full mx-auto mb-3 ${isNight ? 'bg-white/20' : 'bg-gray-300'}`} />
          <h2 className={`font-outfit font-bold text-sm mb-3 px-1 ${isNight ? 'text-white/70' : 'text-gray-600'}`}>
            Cuidados
          </h2>
          <div className="grid grid-cols-3 gap-2.5">
            {actions.map((a) => {
              const isBusy = pet.activity !== 'idle';
              const isActive = pet.activity === a.activityId && isBusy;
              // Desactivado si duerme (salvo despertar), si está ocupado con OTRA acción o si le falta energía
              const off = (pet.isAsleep && a.id !== 'wake') || (isBusy && !isActive) || a.customDisabled;

              let buttonStyles = '';
              if (isActive) {
                buttonStyles = `bg-gradient-to-br ${a.gradient} text-white shadow-[0_0_15px_rgba(255,255,255,0.4)] ring-4 ring-white/50 scale-[0.98]`;
              } else if (off) {
                buttonStyles = isNight
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
                    navigator.vibrate?.(50);
                    a.onPress();
                  }}
                  disabled={off}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl p-3 font-outfit font-semibold text-xs transition-all duration-300 ${buttonStyles}`}
                >
                  <span>{a.icon}</span>
                  <span>{a.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
