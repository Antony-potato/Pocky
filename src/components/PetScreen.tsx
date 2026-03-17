'use client';
import { useEffect, useState } from 'react';
import { usePetStore } from '@/store/petStore';
import PetAvatar from './PetAvatar';
import PetStats  from './PetStats';
import { MOOD_MSG } from '@/lib/sprites';
import { requestNotificationPermission } from '@/lib/messaging';
import { computeAge } from '@/lib/petLogic';

const ACTIVITY_LABEL: Record<string, string> = {
  eating:   'comiendo 🍽️',
  bathing:  'bañándose 🛁',
  walking:  'paseando 🦮',
  playing:  'jugando 🎾',
  sleeping: 'durmiendo 😴',
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
    { id: 'feed',  emoji: '🍖', label: 'Alimentar', onPress: () => pet.feed('normal'), disabled: pet.activity !== 'idle' },
    { id: 'treat', emoji: '🍬', label: 'Golosina',  onPress: () => pet.feed('treat'),  disabled: pet.activity !== 'idle' },
    { id: 'bath',  emoji: '🛁', label: 'Bañar',     onPress: pet.bathe,                disabled: pet.activity !== 'idle' },
    { id: 'walk',  emoji: '🦮', label: 'Pasear',    onPress: pet.walk,                 disabled: pet.activity !== 'idle' || pet.energy < 15 },
    { id: 'play',  emoji: '🎾', label: 'Jugar',     onPress: pet.play,                 disabled: pet.activity !== 'idle' || pet.energy < 10 },
    {
      id:      pet.isAsleep ? 'wake' : 'sleep',
      emoji:   pet.isAsleep ? '☀️' : '🌙',
      label:   pet.isAsleep ? 'Despertar' : 'Dormir',
      onPress: pet.isAsleep ? pet.wakeUp : pet.putToSleep,
    },
  ];

  if (!isMounted) {
    return (
      <main className="h-dvh bg-cream flex justify-center items-center">
        <p className="font-mono text-gray-500 animate-pulse">Despertando a Pocky... 🐰</p>
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
            <span className="text-[10px] text-gray-400">🐾 {petAge}d</span>
          </div>
          <div className="flex flex-col gap-1">
            {[
              { emoji: '🍖', value: pet.hunger, color: 'bg-orange-400' },
              { emoji: '😊', value: pet.happiness, color: 'bg-green-400' },
              { emoji: '🫧', value: pet.cleanliness, color: 'bg-sky-400' },
              { emoji: '⚡', value: pet.energy, color: 'bg-yellow-400' },
              { emoji: '❤️', value: pet.health, color: 'bg-red-400' },
            ].map(s => (
              <div key={s.emoji} className="flex items-center gap-1">
                <span className="text-[10px]">{s.emoji}</span>
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
          🔔
        </button>

        {/* Burbuja de diálogo flotante */}
        <div className="relative mb-2 z-10">
          <div className="bg-white rounded-2xl px-4 py-2 shadow-md border border-amber-100 relative">
            <p className="text-gray-600 font-medium text-sm text-center whitespace-nowrap">
              {MOOD_MSG[pet.mood] || '...'}
            </p>
            {/* Triángulo de la burbuja */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-white" />
          </div>
        </div>

        {/* Mascota Grande y centrada — sin recuadro */}
        <PetAvatar species={pet.species} mood={pet.mood} activity={pet.activity} />

        {/* Banner de actividad flotante */}
        {pet.activity !== 'idle' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-purple/90 backdrop-blur-sm rounded-full px-5 py-2 shadow-lg z-10">
            <p className="text-white font-bold text-sm animate-pulse whitespace-nowrap">
              {pet.name} está {ACTIVITY_LABEL[pet.activity]}...
            </p>
          </div>
        )}

        {/* Alertas de necesidades flotantes */}
        {pet.needs && pet.needs.length > 0 && (
          <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10">
            {pet.needs.map(n => (
              <div
                key={n.id}
                className={`rounded-full px-3 py-1 text-xs font-bold text-gray-800 shadow-md animate-pulse
                  ${n.urgency === 'critical' ? 'bg-red-300' :
                    n.urgency === 'high'     ? 'bg-orange-200' : 'bg-yellow-100'}`}
              >
                {n.emoji} {n.message}
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
                  flex flex-col items-center justify-center gap-1
                  rounded-2xl p-3 shadow-sm border border-gray-100
                  font-semibold text-xs
                  transition-all duration-150 active:scale-95
                  ${off
                    ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                    : 'bg-white text-gray-700 hover:bg-amber-50 hover:border-amber-200 cursor-pointer'
                  }
                `}
              >
                <span className="text-2xl">{a.emoji}</span>
                <span>{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>

    </main>
  );
}