'use client';
import { useEffect, useState } from 'react';
import { usePetStore } from '@/store/petStore';
import PetAvatar from './PetAvatar';
import PetStats  from './PetStats';
import ActionPad from './ActionPad';
import { MOOD_MSG } from '@/lib/sprites';
import { requestNotificationPermission } from '@/lib/messaging';

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

  // 1. Truco de hidratación: le decimos a React que ya estamos en el cliente
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Helper para registrar notificaciones
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

  // 2. Conectar a Firebase y arrancar cron local para actualizar stats en pantalla
  useEffect(() => {
    if (!isMounted) return;
    
    // Iniciar escucha a Firebase
    const unsub = pet.startListening();
    
    // Solicitar permiso de notificaciones automáticamente
    requestNotificationPermission().then(result => {
      if (result) {
        if (result.type === 'fcm') {
          usePetStore.getState().registerFCMToken(result.token);
        } else {
          usePetStore.getState().registerWebPushSubscription(result.subscription);
        }
      }
    });
    
    // Intervalo local: ejecutamos tick cada 20 segundos para que 
    // mientras duerma (o esté activo), los stats se actualicen 
    // visualmente en tiempo real apenas pase 1 minuto en Date.now()
    const interval = setInterval(() => {
      usePetStore.getState().tick();
    }, 20000); 

    return () => {
      unsub();
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted]);

  const actions = [
    { id: 'feed',  emoji: '🍖', label: 'Alimentar', color: 'bg-orange-400', onPress: () => pet.feed('normal'), disabled: pet.activity !== 'idle' },
    { id: 'treat', emoji: '🍬', label: 'Golosina',  color: 'bg-pink',       onPress: () => pet.feed('treat'),  disabled: pet.activity !== 'idle' },
    { id: 'bath',  emoji: '🛁', label: 'Bañar',     color: 'bg-sky-400',    onPress: pet.bathe,                disabled: pet.activity !== 'idle' },
    { id: 'walk',  emoji: '🦮', label: 'Pasear',    color: 'bg-emerald-400',onPress: pet.walk,                 disabled: pet.activity !== 'idle' || pet.energy < 15 },
    { id: 'play',  emoji: '🎾', label: 'Jugar',     color: 'bg-fuchsia-400',onPress: pet.play,                 disabled: pet.activity !== 'idle' || pet.energy < 10 },
    {
      id:      pet.isAsleep ? 'wake' : 'sleep',
      emoji:   pet.isAsleep ? '☀️' : '🌙',
      label:   pet.isAsleep ? 'Despertar' : 'Dormir',
      color:   pet.isAsleep ? 'bg-yellow-400' : 'bg-purple', 
      onPress: pet.isAsleep ? pet.wakeUp : pet.putToSleep,
    },
  ];

  // 4. Pantalla de carga mientras React cuadra los datos (Evita el error rojo)
  if (!isMounted) {
    return (
      <main className="min-h-screen bg-cream flex justify-center items-center">
        <p className="font-mono text-gray-500 animate-pulse">Despertando a Pocky... 🐰</p>
      </main>
    );
  }

  // 5. La UI real
  return (
    <main className="min-h-screen bg-cream flex justify-center">
      <div className="w-full max-w-sm px-4 py-8 flex flex-col gap-4">

        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-black text-gray-800">{pet.name}</h1>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${pet.isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-sm text-gray-500">🐾 {pet.age} días</span>
          </div>
        </div>

        {/* Burbuja de diálogo */}
        <div className="bg-white rounded-2xl px-4 py-3 border border-amber-200 shadow-sm flex items-center justify-between gap-2">
          <p className="text-center text-gray-600 font-medium font-mono text-sm flex-1">
            {MOOD_MSG[pet.mood] || '...'}
          </p>
          <button
            onClick={handleEnableNotifications}
            className="text-lg opacity-60 hover:opacity-100 active:scale-110 transition-all"
            title="Activar notificaciones"
          >
            🔔
          </button>
        </div>

        {/* Avatar */}
        <PetAvatar species={pet.species} mood={pet.mood} activity={pet.activity} />

        {/* Necesidades activas */}
        {pet.needs && pet.needs.length > 0 && (
          <div className="flex flex-col gap-2">
            {pet.needs.map(n => (
              <div
                key={n.id}
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-gray-800
                  ${n.urgency === 'critical' ? 'bg-red-200' :
                    n.urgency === 'high'     ? 'bg-orange-200' : 'bg-yellow-100'}`}
              >
                {n.emoji} {n.message}
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h2 className="font-bold text-gray-700 mb-3">Estado</h2>
          <PetStats
            hunger={pet.hunger}
            happiness={pet.happiness}
            cleanliness={pet.cleanliness}
            energy={pet.energy}
            health={pet.health}
          />
        </div>

        {/* Acciones */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h2 className="font-bold text-gray-700 mb-3">Cuidados</h2>
          <ActionPad actions={actions} isAsleep={pet.isAsleep} />
        </div>

        {/* Banner actividad */}
        {pet.activity !== 'idle' && (
          <div className="bg-purple rounded-2xl px-5 py-3 text-center">
            <p className="text-white font-bold animate-bounce-soft">
              {pet.name} está {ACTIVITY_LABEL[pet.activity]}...
            </p>
          </div>
        )}

      </div>
    </main>
  );
}