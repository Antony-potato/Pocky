'use client';
import { useEffect, useState } from 'react';
import { usePetStore } from '@/store/petStore';
import PetAvatar from './PetAvatar';
import { MOOD_MSG } from '@/lib/sprites';
import { requestNotificationPermission } from '@/lib/messaging';
import { computeAge } from '@/lib/petLogic';
import {
  Beef, Candy, ShowerHead, TreePalm, Gamepad2, Moon, Sun,
  Bell, PawPrint, Heart, Smile, Droplets, Zap, Bone,
  UtensilsCrossed, Bath as BathIcon, AlertTriangle
} from 'lucide-react';

const ACTIVITY_LABEL: Record<string, { label: string; icon: React.ReactNode }> = {
  eating:   { label: 'comiendo',   icon: <UtensilsCrossed size={14} className="inline" /> },
  bathing:  { label: 'bañándose',  icon: <ShowerHead size={14} className="inline" /> },
  walking:  { label: 'paseando',   icon: <TreePalm size={14} className="inline" /> },
  playing:  { label: 'jugando',    icon: <Gamepad2 size={14} className="inline" /> },
  sleeping: { label: 'durmiendo',  icon: <Moon size={14} className="inline" /> },
};

// Iconos y colores para las alertas de necesidades
const NEED_ICONS: Record<string, { icon: React.ReactNode }> = {
  hunger: { icon: <Bone size={14} className="text-orange-600" /> },
  bath:   { icon: <Droplets size={14} className="text-sky-600" /> },
  play:   { icon: <Gamepad2 size={14} className="text-fuchsia-600" /> },
  sleep:  { icon: <Moon size={14} className="text-indigo-600" /> },
};

export default function PetScreen() {
  const pet = usePetStore();
  const [isMounted, setIsMounted] = useState(false);
  const petAge = isMounted ? computeAge(pet.createdAt || Date.now()) : 0;

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

  const actions = [
    { id: 'feed',  icon: <Beef size={24} />,      iconColor: 'text-orange-500', label: 'Alimentar', onPress: () => pet.feed('normal'), disabled: pet.activity !== 'idle' },
    { id: 'treat', icon: <Candy size={24} />,      iconColor: 'text-pink-400',   label: 'Golosina',  onPress: () => pet.feed('treat'),  disabled: pet.activity !== 'idle' },
    { id: 'bath',  icon: <ShowerHead size={24} />,  iconColor: 'text-sky-400',    label: 'Bañar',     onPress: pet.bathe,                disabled: pet.activity !== 'idle' },
    { id: 'walk',  icon: <TreePalm size={24} />,    iconColor: 'text-emerald-500',label: 'Pasear',    onPress: pet.walk,                 disabled: pet.activity !== 'idle' || pet.energy < 15 },
    { id: 'play',  icon: <Gamepad2 size={24} />,    iconColor: 'text-fuchsia-500',label: 'Jugar',     onPress: pet.play,                 disabled: pet.activity !== 'idle' || pet.energy < 10 },
    {
      id:        pet.isAsleep ? 'wake' : 'sleep',
      icon:      pet.isAsleep ? <Sun size={24} /> : <Moon size={24} />,
      iconColor: pet.isAsleep ? 'text-yellow-500' : 'text-indigo-400',
      label:     pet.isAsleep ? 'Despertar' : 'Dormir',
      onPress:   pet.isAsleep ? pet.wakeUp : pet.putToSleep,
    },
  ];

  if (!isMounted) {
    return (
      <main className="h-dvh bg-cream flex justify-center items-center">
        <p className="font-mono text-gray-500 animate-pulse">Despertando a Pocky...</p>
      </main>
    );
  }

  return (
    <main className="h-dvh bg-cream flex flex-col overflow-hidden relative">

      {/* ===== ZONA SUPERIOR: Pet area ===== */}
      <div className="flex-1 relative flex flex-col items-center justify-center px-4">

        {/* HUD superior izquierdo: Stats compactos */}
        <div className="absolute top-4 left-4 bg-white/70 backdrop-blur-md rounded-2xl px-3 py-2 shadow-sm z-10">
          <div className="flex items-center gap-1.5 mb-1">
            <div className={`w-2 h-2 rounded-full ${pet.isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-xs font-bold text-gray-700">{pet.name}</span>
            <PawPrint size={10} className="text-gray-400" />
            <span className="text-[10px] text-gray-400">{petAge}d</span>
          </div>
          <div className="flex flex-col gap-1">
            {[
              { icon: <Bone size={10} className="text-orange-500" />, value: pet.hunger, color: 'bg-orange-400', key: 'hunger' },
              { icon: <Smile size={10} className="text-green-500" />, value: pet.happiness, color: 'bg-green-400', key: 'happy' },
              { icon: <Droplets size={10} className="text-sky-500" />, value: pet.cleanliness, color: 'bg-sky-400', key: 'clean' },
              { icon: <Zap size={10} className="text-yellow-500" />, value: pet.energy, color: 'bg-yellow-400', key: 'energy' },
              { icon: <Heart size={10} className="text-red-400" />, value: pet.health, color: 'bg-red-400', key: 'health' },
            ].map(s => (
              <div key={s.key} className="flex items-center gap-1">
                {s.icon}
                <div className="w-16 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${s.value < 20 ? 'bg-red-400' : s.color}`}
                    style={{ width: `${s.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* HUD superior derecho: Notificación */}
        <button
          onClick={handleEnableNotifications}
          className="absolute top-4 right-4 bg-white/70 backdrop-blur-md rounded-full w-10 h-10 flex items-center justify-center shadow-sm z-10 active:scale-90 transition-transform"
          title="Activar notificaciones"
        >
          <Bell size={18} className="text-amber-500" />
        </button>

        {/* Burbuja de diálogo flotante */}
        <div className="relative mb-2 z-10">
          <div className="bg-white rounded-2xl px-4 py-2 shadow-md border border-amber-100 relative">
            <p className="text-gray-600 font-medium text-sm text-center whitespace-nowrap">
              {MOOD_MSG[pet.mood] || '...'}
            </p>
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-white" />
          </div>
        </div>

        {/* Mascota Grande y centrada */}
        <PetAvatar species={pet.species} mood={pet.mood} activity={pet.activity} />

        {/* Banner de actividad flotante */}
        {pet.activity !== 'idle' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-purple/90 backdrop-blur-sm rounded-full px-5 py-2 shadow-lg z-10 flex items-center gap-2">
            {ACTIVITY_LABEL[pet.activity]?.icon}
            <p className="text-white font-bold text-sm animate-pulse whitespace-nowrap">
              {pet.name} está {ACTIVITY_LABEL[pet.activity]?.label}...
            </p>
          </div>
        )}

        {/* Alertas de necesidades flotantes */}
        {pet.needs && pet.needs.length > 0 && (
          <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10">
            {pet.needs.map(n => (
              <div
                key={n.id}
                className={`rounded-full px-3 py-1 text-xs font-bold text-gray-800 shadow-md animate-pulse flex items-center gap-1.5
                  ${n.urgency === 'critical' ? 'bg-red-300' :
                    n.urgency === 'high'     ? 'bg-orange-200' : 'bg-yellow-100'}`}
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

      {/* ===== ZONA INFERIOR: Bottom Sheet con acciones ===== */}
      <div className="bg-white rounded-t-[2rem] shadow-[0_-4px_20px_rgba(0,0,0,0.08)] px-5 pt-4 pb-6 z-20">
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
        <h2 className="font-bold text-gray-700 text-sm mb-3 px-1">Cuidados</h2>
        <div className="grid grid-cols-3 gap-3">
          {actions.map((a) => {
            const off = a.disabled || (pet.isAsleep && a.id !== 'wake');
            return (
              <button
                key={a.id}
                onClick={() => !off && a.onPress()}
                disabled={off}
                className={`
                  flex flex-col items-center justify-center gap-1.5
                  rounded-2xl p-3 shadow-sm border border-gray-100
                  font-semibold text-xs
                  transition-all duration-150 active:scale-95
                  ${off
                    ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                    : 'bg-white text-gray-700 hover:bg-amber-50 hover:border-amber-200 cursor-pointer'
                  }
                `}
              >
                <span className={off ? 'text-gray-300' : a.iconColor}>{a.icon}</span>
                <span>{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>

    </main>
  );
}