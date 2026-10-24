'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePetStore, getDeviceId } from '@/store/petStore';
import CircularStats, { HUD_DARK, PILL } from './CircularStats';
import ActivityLog from './ActivityLog';
import Wardrobe from './Wardrobe';
import Splash from './Splash';
import { requestNotificationPermission } from '@/lib/messaging';
import { computeAge, currentStreak, refuses, MEDICINE_BELOW, ACCESSORIES, type PetAction } from '@/lib/petLogic';
import { Utensils, Candy, ShowerHead, TreePine, Gamepad2, Pill, Moon, Sun, Bell, PawPrint, WifiOff, Wifi, Flame, Shirt, History as HistoryIcon, type LucideIcon } from 'lucide-react';

// Three.js solo en el cliente (usa WebGL y window). Mientras carga, la tapa el Splash.
const World = dynamic(() => import('./scene/World'), { ssr: false });

// Estilo del icono: 'line' = solo trazo; 'solid' = relleno del mismo color; 'cutout' = relleno con detalles oscuros.
type IconStyle = 'line' | 'solid' | 'cutout';
function iconColors(style: IconStyle, color: string, active: boolean) {
  if (style === 'line') return { color: active ? '#fff' : color };
  if (style === 'solid') return { color: active ? '#fff' : color, fill: active ? '#fff' : color };
  return { color: active ? color : HUD_DARK, fill: active ? '#fff' : color };
}

// Necesidad → acción que se sugiere (se destaca en el dock).
const SUGGEST: Record<string, string> = { medicine: 'medicine', hunger: 'feed', bath: 'bathe', play: 'play', sleep: 'sleep' };

// Tamaños fluidos: se adaptan del móvil más pequeño (320px) al escritorio, también en horizontal.
const SIZES = {
  '--btn': 'clamp(2.5rem, min(12.5vw, 9svh), 3.5rem)',
  '--ring': 'clamp(1.75rem, 5.2svh, 2.5rem)',
  '--gap': 'clamp(0.3rem, 1.6vw, 0.6rem)',
} as React.CSSProperties;
// Con 7 botones (medicina) más pequeños: si no, en 320-390 px el dock se sale de la pantalla.
const SIZES_7 = { '--btn': 'clamp(2.2rem, min(11vw, 9svh), 3.5rem)' } as React.CSSProperties;

export default function PetScreen() {
  const pet = usePetStore();
  const [isMounted, setIsMounted] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const [splash, setSplash] = useState(true);
  const [worldReady, setWorldReady] = useState(false);
  const [minTime, setMinTime] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [reconnected, setReconnected] = useState(false);
  const [askName, setAskName] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showWardrobe, setShowWardrobe] = useState(false);
  // Accesorios desbloqueados que este móvil aún no ha visto en el armario → punto en el botón.
  const unlocked = ACCESSORIES.filter(it => (pet.totalCaresGiven ?? 0) >= it.cares).length;
  const [seenUnlocks, setSeenUnlocks] = useState(Infinity); // hasta leer localStorage, sin punto
  useEffect(() => { try { setSeenUnlocks(Number(localStorage.getItem('pocky_seen_unlocks') ?? 0)); } catch { setSeenUnlocks(0); } }, []);
  const prevConnected = useRef<boolean | null>(null);
  const hour = pet.isAsleep ? 22 : isMounted ? new Date().getHours() : 10;
  const petAge = isMounted && pet.createdAt ? computeAge(pet.createdAt) : null;
  const streak = isMounted ? currentStreak(pet) : 0;

  useEffect(() => {
    setIsMounted(true);
    // Mínimo para que se lea la animación; máximo de espera al servidor antes de entrar sin conexión.
    const a = setTimeout(() => setMinTime(true), 1400), b = setTimeout(() => setTimedOut(true), 7000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);

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
    // Nombre de este móvil (historial, avisos al otro). Si ya lo tiene se reenvía por si el doc no lo guarda aún.
    const name = localStorage.getItem('pocky_name');
    if (name) pet.setName(name); else setAskName(true);
    // Si ya hay permiso, renueva el token en silencio (sin prompt): los tokens caducan y si no se
    // actualizan dejan de llegar notificaciones a ese móvil.
    if ('Notification' in window && Notification.permission === 'granted') {
      requestNotificationPermission().then(r => { if ('token' in r) usePetStore.getState().registerFCMToken(r.token); });
    }
    const interval = setInterval(() => { usePetStore.getState().tick(); }, 20000);
    return () => { unsub(); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted]);

  // Barra de estado del color que se ve arriba en la escena (World lo lee del canvas); oscura durante la carga.
  // iOS 26+ la tiñe con el fondo de html/body; Android usa theme-color.
  const paintStatusBar = useCallback((color: string) => {
    document.documentElement.style.setProperty('--scene-bg', color);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  }, []);
  useEffect(() => { if (splash) paintStatusBar('#151a19'); }, [splash, paintStatusBar]);

  // Aviso al recuperar la conexión (mismo hueco que el aviso de "sin conexión").
  useEffect(() => {
    if (splash) { prevConnected.current = pet.isConnected; return; }
    const was = prevConnected.current;
    prevConnected.current = pet.isConnected;
    if (was === false && pet.isConnected) {
      setReconnected(true);
      const t = setTimeout(() => setReconnected(false), 3500);
      return () => clearTimeout(t);
    }
  }, [pet.isConnected, splash]);

  // Durante una acción (de cualquiera de los dos móviles), tick cada segundo: la barra sube poco a poco y acaba a su hora.
  const acting = pet.activity !== 'idle' && !pet.isAsleep;
  useEffect(() => {
    if (!acting) return;
    const i = setInterval(() => usePetStore.getState().tick(), 1000);
    return () => clearInterval(i);
  }, [acting]);

  // ---- Pantalla de carga ----
  const startedOffline = isMounted && !navigator.onLine;
  const ready = worldReady && minTime && (pet.loaded || timedOut || startedOffline);
  const progress = 0.1 + (pet.hasData ? 0.25 : 0) + (pet.loaded ? 0.35 : 0) + (worldReady ? 0.25 : 0);
  const status = pet.loaded
    ? (worldReady ? '¡Listo!' : 'Preparando la isla…')
    : pet.syncError ? 'No se pudo conectar con el servidor: entrarás sin guardar cambios'
    : timedOut || startedOffline ? 'Sin internet: entrarás sin guardar cambios' : 'Despertando a Pocky…';
  const onWorldReady = useCallback(() => setWorldReady(true), []);
  const onSplashDone = useCallback(() => setSplash(false), []);

  const actions: { id: PetAction; activityId: string; Icon: LucideIcon; style: IconStyle; color: string; label: string }[] = [
    { id: 'feed', activityId: 'eating', Icon: Utensils, style: 'line', color: '#ff9f43', label: 'Alimentar' },
    { id: 'treat', activityId: 'snacking', Icon: Candy, style: 'cutout', color: '#f0506e', label: 'Golosina' },
    { id: 'bathe', activityId: 'bathing', Icon: ShowerHead, style: 'line', color: '#38bdf8', label: 'Bañar' },
    { id: 'walk', activityId: 'walking', Icon: TreePine, style: 'solid', color: '#34d399', label: 'Pasear' },
    { id: 'play', activityId: 'playing', Icon: Gamepad2, style: 'cutout', color: '#c084fc', label: 'Jugar' },
    // Solo cuando le hace falta (o mientras se la toma): el resto del tiempo el dock se queda en 6.
    ...(pet.health < MEDICINE_BELOW || pet.activity === 'healing'
      ? [{ id: 'medicine', activityId: 'healing', Icon: Pill, style: 'line', color: '#f87171', label: 'Medicina' } as const] : []),
    pet.isAsleep
      ? { id: 'wake', activityId: 'sleeping', Icon: Sun, style: 'solid', color: '#fbbf24', label: 'Despertar' }
      : { id: 'sleep', activityId: 'sleeping', Icon: Moon, style: 'solid', color: '#8b9cff', label: 'Dormir' },
  ];

  // Destacado: la acción en curso (la pulsada aquí, o la primera que encaje si la pulsó la otra persona);
  // si no hay ninguna, la que sugiere la necesidad más urgente.
  const busy = pet.activity !== 'idle';
  const highlight = busy
    ? (actions.find(a => a.id === pressed && a.activityId === pet.activity) ?? actions.find(a => a.activityId === pet.activity))?.id
    : SUGGEST[pet.needs?.[0]?.id ?? ''];
  const highlightLabel = actions.find(a => a.id === highlight)?.label;
  const offline = !splash && !pet.isConnected;

  return (
    // fixed inset-0, no h-dvh: en la PWA de iOS 26 dvh se queda con la altura vieja al girar horizontal → vertical.
    <main className="fixed inset-0 overflow-hidden bg-[#151a19] font-nunito select-none" style={actions.length > 6 ? { ...SIZES, ...SIZES_7 } : SIZES}>
      {/* ===== ESCENA 3D (fondo a pantalla completa, también bajo la barra de estado) ===== */}
      <div className="absolute inset-0 z-0">{isMounted && <World hour={hour} onReady={onWorldReady} onTint={splash ? undefined : paintStatusBar} />}</div>

      {/* ===== HUD: no captura toques salvo en sus píldoras, para poder girar la isla ===== */}
      <div className="absolute inset-0 z-10 pointer-events-none px-[max(1rem,env(safe-area-inset-left))] pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col">
        <div className="flex items-center justify-between gap-3">
          <div className={`${PILL} pointer-events-auto rounded-full h-12 pl-1.5 pr-5 flex items-center gap-2.5 min-w-0`}>
            <div className="relative shrink-0 w-9 h-9 rounded-full bg-[#ff9f43] flex items-center justify-center">
              <PawPrint size={19} fill={HUD_DARK} color={HUD_DARK} strokeWidth={1.5} />
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#151a19] ${pet.isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}
                title={pet.isConnected ? 'Conectado' : 'Sin conexión'}
              />
            </div>
            <h1 className="text-white text-xl font-black leading-none truncate">{pet.name}</h1>
            {petAge !== null && <span className="text-white/45 font-extrabold leading-none shrink-0" title={`${petAge} días con vosotros`}>{petAge}d</span>}
            {streak > 0 && (
              <span className="flex items-center gap-0.5 text-[#ff9f43] font-extrabold leading-none shrink-0" title={`Racha: ${streak} días seguidos cuidándolo`}>
                <Flame size={15} fill="#ff9f43" color="#ff9f43" aria-hidden />{streak}
              </span>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => { setShowWardrobe(true); setSeenUnlocks(unlocked); try { localStorage.setItem('pocky_seen_unlocks', String(unlocked)); } catch {} }}
              className={`${PILL} relative pointer-events-auto rounded-full w-12 h-12 flex items-center justify-center active:scale-90 transition-transform`}
              aria-label={unlocked > seenUnlocks ? 'Armario (accesorio nuevo)' : 'Armario'} title="Armario"
            >
              <Shirt size={20} color="#c084fc" fill="#c084fc" />
              {unlocked > seenUnlocks && <span className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full bg-[#ff5c7a] border-2 border-[#151a19]" />}
            </button>
            <button
              onClick={() => setShowLog(true)}
              className={`${PILL} pointer-events-auto rounded-full w-12 h-12 flex items-center justify-center active:scale-90 transition-transform`}
              aria-label="Historial" title="Historial"
            >
              <HistoryIcon size={20} color="#e5e7eb" strokeWidth={2.5} />
            </button>
            <button
              onClick={handleEnableNotifications}
              className={`${PILL} pointer-events-auto rounded-full w-12 h-12 flex items-center justify-center active:scale-90 transition-transform`}
              aria-label="Activar notificaciones" title="Activar notificaciones"
            >
              <Bell size={20} fill="#fcd34d" color="#fcd34d" />
            </button>
          </div>
        </div>

        {/* Estado de conexión: icono + texto (no solo color), sin bloquear, anunciado a lectores de pantalla */}
        <div role="status" aria-live="polite" className="mt-3 empty:hidden">
          {(offline || reconnected) && (
            <div className={`${PILL} pointer-events-auto rounded-2xl px-3 py-2 flex items-center gap-2.5 max-w-md ${offline ? 'border-amber-400/40' : 'border-emerald-400/40'}`}>
              <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${offline ? 'bg-amber-400/15' : 'bg-emerald-400/15'}`}>
                {offline ? <WifiOff size={16} className="text-amber-300" /> : <Wifi size={16} className="text-emerald-300" />}
              </span>
              <p className="text-[13px] leading-snug text-white/80">
                {offline ? (
                  <><b className="text-amber-300 font-extrabold">{pet.syncError ? 'No se pudo conectar con el servidor.' : 'Sin conexión.'}</b> Puedes jugar con {pet.name} y verlo, pero lo que hagas no se guardará.
                    {!pet.hasData && ' Aún no se han cargado sus datos.'}
                    {pet.syncError && <span className="text-white/45"> (error: {pet.syncError})</span>}</>
                ) : (
                  <><b className="text-emerald-300 font-extrabold">Conectado de nuevo.</b> {pet.name} vuelve a su estado guardado.</>
                )}
              </p>
            </div>
          )}
        </div>

        <div className={`${PILL} pointer-events-auto mt-3 self-start rounded-full p-1.5`}>
          <CircularStats hunger={pet.hunger} happiness={pet.happiness} cleanliness={pet.cleanliness} energy={pet.energy} health={pet.health} />
        </div>

        {/* ===== DOCK de acciones: anclado abajo (fuera del flujo) para que quepa también en horizontal ===== */}
        <div className="absolute inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-2">
          <div className={`${PILL} rounded-full px-3.5 py-1 text-white font-extrabold text-[15px] transition-opacity duration-300 ${highlightLabel ? 'opacity-100' : 'opacity-0'}`}>
            {highlightLabel ?? '·'}
          </div>
          <div className={`${PILL} pointer-events-auto rounded-full p-[var(--gap)] flex gap-[var(--gap)]`}>
            {actions.map(a => {
              // Ocupado: solo queda encendida la acción en curso. Libre: apagadas las que no quiere (lleno o sin energía).
              const off = (pet.isAsleep && a.id !== 'wake') || (busy ? a.activityId !== pet.activity : refuses(pet, a.id));
              const active = a.id === highlight && !off;
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    if (off) return;
                    navigator.vibrate?.(50);
                    setPressed(a.id);
                    pet.act(a.id);
                  }}
                  disabled={off}
                  aria-label={a.label} title={a.label}
                  className={`w-[var(--btn)] h-[var(--btn)] rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 hover:brightness-125 ${off ? 'opacity-30' : ''}`}
                  style={active ? { background: a.color, boxShadow: `0 0 22px ${a.color}aa` } : { background: '#262c2d' }}
                >
                  <a.Icon className="w-[46%] h-[46%]" strokeWidth={a.style === 'line' ? 2.6 : 2} {...iconColors(a.style, a.color, active)} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showLog && <ActivityLog pet={pet} me={getDeviceId()} onClose={() => setShowLog(false)} />}
      {showWardrobe && <Wardrobe pet={pet} onWear={id => pet.act('wear', id)} onClose={() => setShowWardrobe(false)} />}

      {askName && !splash && (
        <form
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 px-4"
          onSubmit={e => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
            if (!name) return;
            pet.setName(name);
            setAskName(false);
          }}
        >
          <div className={`${PILL} rounded-3xl p-5 w-full max-w-xs flex flex-col gap-3`}>
            <label htmlFor="pocky-name" className="text-white font-black text-lg leading-tight">¿Cómo te llamas?</label>
            <p className="text-white/60 text-sm -mt-2">Así {pet.name} sabe quién lo cuida.</p>
            {/* text-base (16px): con menos iOS hace zoom al enfocar. select-text: el body tiene user-select none. */}
            <input
              id="pocky-name" name="name" required maxLength={20} autoComplete="given-name" autoFocus
              className="select-text rounded-xl bg-white/10 text-white text-base px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#ff9f43]"
            />
            <button className="rounded-xl bg-[#ff9f43] text-[#151a19] font-black py-2.5 active:scale-95 transition-transform">Listo</button>
          </div>
        </form>
      )}

      {splash && <Splash progress={progress} ready={ready} status={status} onDone={onSplashDone} />}
    </main>
  );
}
