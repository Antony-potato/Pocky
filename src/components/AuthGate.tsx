'use client';
import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { PawPrint } from 'lucide-react';
import { auth, api, signInGoogle } from '@/lib/firebase';
import { setServerTime } from '@/store/petStore';
import { CODE_LENGTH, HOME_KEY, normalizeCode, type HomeCache } from '@/lib/home';
import { PILL } from './CircularStats';
import PetScreen from './PetScreen';

const SIGN_IN_ERRORS: Record<string, string> = {
  'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication → Configuración → Dominios autorizados).',
  'auth/operation-not-allowed': 'El acceso con Google no está activado en Firebase (Authentication → Sign-in method).',
  'auth/popup-closed-by-user': '', 'auth/cancelled-popup-request': '',
};
const BTN = 'rounded-xl bg-[#ff9f43] text-[#151a19] font-black py-2.5 active:scale-95 transition-transform disabled:opacity-50';
const INPUT = 'select-text rounded-xl bg-white/10 text-white text-base px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#ff9f43]';

/**
 * Puerta de entrada: sesión de Google → hogar (unirse con código o crear mascota) → el juego.
 * Quien no tiene ningún hogar ve el formulario; `/?nuevo` lo abre también para añadir otro (botón de Ajustes).
 */
export default function AuthGate() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = Firebase aún restaura la sesión
  const [home, setHome] = useState<HomeCache | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Sesiones anónimas de la versión anterior no valen: hay que entrar con Google.
  useEffect(() => onAuthStateChanged(auth, u => setUser(u && !u.isAnonymous ? u : null)), []);
  useEffect(() => setAdding(new URLSearchParams(location.search).has('nuevo')), []);

  const save = (h: HomeCache) => { setHome(h); try { localStorage.setItem(HOME_KEY, JSON.stringify(h)); } catch {} };

  useEffect(() => {
    if (!user) return setHome(null);
    let cached: HomeCache | null = null;
    try { // lo último que se supo, al instante (y sin conexión); el servidor lo confirma o corrige enseguida
      cached = JSON.parse(localStorage.getItem(HOME_KEY) ?? 'null');
      if (cached?.uid === user.uid && Array.isArray(cached.homes)) setHome(cached); else cached = null;
    } catch {}
    const sent = Date.now();
    api<{ now: number; admin: boolean; homes: HomeCache['homes'] }>('/api/home', { op: 'me' }).then(r => {
      setServerTime(r.now, sent, Date.now());
      // Sigue en el hogar en el que estaba este móvil, si aún es suyo; si no, en el primero.
      const current = r.homes.find(h => h.id === cached?.current)?.id ?? r.homes[0]?.id ?? null;
      save({ uid: user.uid, admin: r.admin, homes: r.homes, current });
    }).catch(e => setError(e.message)); // sin red: se queda con lo guardado
  }, [user]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await work(); } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setError(SIGN_IN_ERRORS[code] ?? (e as Error).message);
    } finally { setBusy(false); }
  };
  const enter = (body: object) => run(async () => {
    const r = await api<{ petId: string }>('/api/home', body);
    const homes = home?.homes.some(h => h.id === r.petId) ? home.homes : [...(home?.homes ?? []), { id: r.petId, name: '' }];
    save({ uid: user!.uid, admin: home?.admin ?? false, homes, current: r.petId });
    if (adding) location.replace('/'); else setAdding(false);
  });

  const me = user ? { uid: user.uid, name: user.displayName?.split(' ')[0] ?? '', email: user.email ?? '' } : null;
  if (me && home?.current && !adding)
    return <PetScreen key={home.current} petId={home.current} homes={home.homes} admin={home.admin} me={me} />;

  const loading = user === undefined || (user && !home && !error);
  return (
    <main className="fixed inset-0 overflow-y-auto bg-[#151a19] font-nunito flex flex-col items-center justify-center gap-5 px-4 py-8">
      <div className="w-20 h-20 shrink-0 rounded-full bg-[#ff9f43] flex items-center justify-center">
        <PawPrint size={44} fill="#151a19" color="#151a19" strokeWidth={1.5} />
      </div>
      <h1 className="text-white font-black text-4xl leading-none">Pocky</h1>

      {loading ? <p className="text-white/55 font-bold text-sm" role="status">Cargando…</p> : !user ? (
        <div className={`${PILL} rounded-3xl p-5 w-full max-w-xs flex flex-col gap-3`}>
          <p className="text-white/70 text-sm text-center">Una mascota virtual para cuidar entre varios. Entra con tu cuenta para unirte a un hogar con su código o crear el tuyo.</p>
          <button className={BTN} disabled={busy} onClick={() => run(signInGoogle)}>Entrar con Google</button>
        </div>
      ) : (
        <div className="w-full max-w-xs flex flex-col gap-3">
          <form className={`${PILL} rounded-3xl p-5 flex flex-col gap-3`} onSubmit={e => { e.preventDefault(); enter({ op: 'join', code: new FormData(e.currentTarget).get('code') }); }}>
            <label htmlFor="join-code" className="text-white font-black text-lg leading-tight">¿Tienes un código?</label>
            <p className="text-white/60 text-sm -mt-2">Te lo pasa quien ya cuida a la mascota (está en sus Ajustes).</p>
            <input
              id="join-code" name="code" required maxLength={CODE_LENGTH + 2} autoComplete="off" autoCapitalize="characters" spellCheck={false}
              placeholder={'•'.repeat(CODE_LENGTH)} onInput={e => { e.currentTarget.value = normalizeCode(e.currentTarget.value); }}
              className={`${INPUT} text-center text-2xl font-black tracking-[0.3em] uppercase`}
            />
            <button className={BTN} disabled={busy}>Unirme</button>
          </form>
          <form className={`${PILL} rounded-3xl p-5 flex flex-col gap-3`} onSubmit={e => { e.preventDefault(); enter({ op: 'create', name: new FormData(e.currentTarget).get('name') }); }}>
            <label htmlFor="pet-name" className="text-white font-black text-lg leading-tight">O crea un hogar nuevo</label>
            <p className="text-white/60 text-sm -mt-2">Adoptas una mascota y recibes un código para invitar.</p>
            <input id="pet-name" name="name" required maxLength={20} placeholder="¿Cómo se llama?" className={INPUT} />
            <button className={BTN} disabled={busy}>Crear</button>
          </form>
          {home?.current
            ? <a href="/" className="text-white/60 text-sm font-bold underline self-center">Volver con mi mascota</a>
            : <button className="text-white/45 text-sm font-bold underline self-center" onClick={() => auth.signOut()}>Salir de {user.email}</button>}
        </div>
      )}
      <p role="alert" className="text-amber-300 text-sm font-bold text-center max-w-xs empty:hidden">{error}</p>
    </main>
  );
}
