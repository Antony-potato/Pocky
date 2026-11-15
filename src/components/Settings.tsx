'use client';
import { useState } from 'react';
import { X, MapPin, Search, Copy, RefreshCw, Crown, Bell, LogOut, ShieldCheck, Home, Plus, Check } from 'lucide-react';
import type { City, PetData } from '@/types/pet';
import { auth, api } from '@/lib/firebase';
import { usePetStore } from '@/store/petStore';
import { searchCity, cityHere } from '@/lib/weather';
import { PILL } from './CircularStats';
import { HOME_KEY, switchHome } from '@/lib/home';

const ROW = 'rounded-xl bg-white/[0.07] text-white text-sm font-extrabold px-3 py-2.5 flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-50';
const H3 = 'text-white/50 text-xs font-black uppercase tracking-wider';

/** Ajustes: ciudad del clima, hogar (código de invitación y quién está), avisos y cuenta. */
export default function Settings({ pet, petId, homes, me, admin, onNotifications, onClose }: {
  pet: PetData; petId: string; homes: { id: string; name: string }[]; me: { uid: string; email: string }; admin: boolean;
  onNotifications: () => void; onClose: () => void;
}) {
  const [found, setFound] = useState<City[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const members = Object.entries(pet.members ?? {}).sort((a, b) => a[1].joinedAt - b[1].joinedAt);

  const run = async (work: () => Promise<unknown>, fail = '') => {
    setBusy(true); setMsg('');
    try { await work(); } catch (e) { setMsg(fail || (e as Error).message); } finally { setBusy(false); }
  };
  const pick = (c: City) => run(async () => { await usePetStore.getState().setCity(c); setFound(null); }, 'No se pudo guardar la ciudad.');
  // Salir del hogar o de la cuenta: recargar deja la app limpia (listeners, store) y vuelve a la puerta de entrada.
  const bye = (work: () => Promise<unknown>) => run(async () => { await work(); localStorage.removeItem(HOME_KEY); location.reload(); });
  const share = () => {
    const text = `Únete a ${pet.name} en Pocky con el código ${pet.inviteCode}`;
    if (navigator.share) navigator.share({ text, url: location.origin }).catch(() => {});
    else navigator.clipboard?.writeText(pet.inviteCode ?? '').then(() => setMsg('Código copiado.'), () => {});
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div role="dialog" aria-label="Ajustes" className={`${PILL} rounded-3xl w-full max-w-sm max-h-[85svh] flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between pl-5 pr-2 pt-2">
          <h2 className="text-white font-black text-lg leading-tight">Ajustes</h2>
          <button onClick={onClose} className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-transform" aria-label="Cerrar">
            <X size={20} color="#e5e7eb" strokeWidth={2.5} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-5 flex flex-col gap-2.5">
          <h3 className={H3}>Clima</h3>
          <p className="text-white/70 text-sm -mt-1.5">{pet.city ? <>En la isla hace el tiempo de <b className="text-white">{pet.city.name}</b>.</> : 'Elige una ciudad y en la isla hará su mismo tiempo.'}</p>
          <button className={ROW} disabled={busy} onClick={() => run(async () => pick(await cityHere()), 'No se pudo obtener tu ubicación. Revisa el permiso (y que la app se abra por https).')}>
            <MapPin size={16} className="text-sky-400 shrink-0" /> Usar mi ubicación
          </button>
          <form className="flex gap-2" onSubmit={e => {
            e.preventDefault();
            const q = String(new FormData(e.currentTarget).get('city') ?? '').trim();
            if (q) run(async () => setFound(await searchCity(q)), 'No se pudo buscar la ciudad.');
          }}>
            {/* text-base (16px): con menos iOS hace zoom al enfocar. select-text: el body tiene user-select none. */}
            <input name="city" placeholder="Buscar ciudad…" aria-label="Buscar ciudad" maxLength={60}
              className="select-text min-w-0 flex-1 rounded-xl bg-white/10 text-white text-base px-3 py-2 outline-none focus:ring-2 focus:ring-[#ff9f43]" />
            <button className={ROW} disabled={busy} aria-label="Buscar"><Search size={16} /></button>
          </form>
          {found && (found.length ? found.map(c => (
            <button key={`${c.lat},${c.lon}`} className={ROW} disabled={busy} onClick={() => pick(c)}>{c.name}</button>
          )) : <p className="text-white/50 text-sm">No encontré ninguna ciudad con ese nombre.</p>)}

          <h3 className={`${H3} mt-3`}>Hogar de {pet.name}</h3>
          {pet.inviteCode && (
            <div className="rounded-xl bg-white/[0.07] px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-white/50 text-xs font-bold">Código para invitar</p>
                <p className="select-text text-white text-2xl font-black tracking-[0.25em]">{pet.inviteCode}</p>
              </div>
              <button onClick={share} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:scale-90 transition-transform" aria-label="Compartir código"><Copy size={16} color="#fff" /></button>
              {pet.owner === me.uid && (
                <button disabled={busy} onClick={() => confirm('¿Cambiar el código? El actual dejará de servir (quien ya está dentro se queda).') && run(() => api('/api/home', { op: 'code', petId }))}
                  className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50" aria-label="Cambiar código"><RefreshCw size={16} color="#fff" /></button>
              )}
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {members.map(([uid, m]) => (
              <li key={uid} className="text-white text-sm font-bold flex items-center gap-1.5">
                {m.name}{uid === me.uid && <span className="text-white/45">(tú)</span>}
                {uid === pet.owner && <Crown size={13} className="text-amber-300" aria-label="Creó el hogar" />}
              </li>
            ))}
          </ul>
          <button className={ROW} disabled={busy} onClick={() => confirm(`¿Salir del hogar de ${pet.name}? Para volver necesitarás el código.`) && bye(() => api('/api/home', { op: 'leave', petId }))}>
            <LogOut size={16} className="text-rose-400 shrink-0" /> Salir de este hogar
          </button>

          <h3 className={`${H3} mt-3`}>Cambiar de hogar</h3>
          {homes.map(h => (
            <button key={h.id} className={ROW} disabled={h.id === petId} aria-current={h.id === petId} onClick={() => switchHome(h.id)}>
              <Home size={16} className="text-[#ff9f43] shrink-0" /> <span className="truncate">{h.id === petId ? pet.name : h.name || 'Hogar nuevo'}</span>
              {h.id === petId && <Check size={16} className="ml-auto text-emerald-400 shrink-0" aria-label="Estás aquí" />}
            </button>
          ))}
          <a href="/?nuevo" className={ROW}><Plus size={16} className="text-emerald-400 shrink-0" /> Unirme a otro hogar o crear uno</a>

          <h3 className={`${H3} mt-3`}>Este móvil</h3>
          <button className={ROW} onClick={onNotifications}><Bell size={16} fill="#fcd34d" color="#fcd34d" className="shrink-0" /> Activar notificaciones</button>
          {admin && <a href="/admin" className={ROW}><ShieldCheck size={16} className="text-emerald-400 shrink-0" /> Panel de administración</a>}
          <button className={ROW} disabled={busy} onClick={() => bye(() => auth.signOut())}>
            <LogOut size={16} className="text-white/60 shrink-0" /> <span className="truncate">Cerrar sesión ({me.email})</span>
          </button>
          <p role="status" className="text-amber-300 text-sm font-bold empty:hidden">{msg}</p>
        </div>
      </div>
    </div>
  );
}
