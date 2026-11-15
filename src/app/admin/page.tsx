'use client';
import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, api, signInGoogle } from '@/lib/firebase';

type Pet = { id: string; name: string; inviteCode: string | null; maxMembers: number | null; lastUpdated: number; members: { name: string; owner: boolean }[] };
type Data = { maxMembers: number; maxHomes: number; pets: Pet[] };

const CARD = 'rounded-2xl bg-white/[0.06] border border-white/[0.07] p-4';
const BTN = 'rounded-lg bg-[#ff9f43] text-[#151a19] font-black px-3 py-1.5 text-sm disabled:opacity-50';
const NUM = 'select-text w-20 rounded-lg bg-white/10 text-white text-base px-2 py-1.5 outline-none focus:ring-2 focus:ring-[#ff9f43]';

/** Panel de administración. La página no protege nada: /api/admin comprueba el correo en cada llamada. */
export default function Admin() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [msg, setMsg] = useState('');

  const call = useCallback(async (body: object) => {
    setMsg('');
    try {
      if ((body as { op?: string }).op !== 'list') await api('/api/admin', body);
      setData(await api<Data>('/api/admin', { op: 'list' }));
    } catch (e) { setMsg((e as Error).message); }
  }, []);
  useEffect(() => onAuthStateChanged(auth, u => { setSignedIn(!!u && !u.isAnonymous); if (u && !u.isAnonymous) call({ op: 'list' }); }), [call]);

  return (
    // El body no hace scroll ni deja seleccionar texto (es un juego): aquí sí.
    <main className="fixed inset-0 overflow-y-auto bg-[#151a19] font-nunito text-white select-text p-4 sm:p-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="font-black text-2xl">Pocky · Administración</h1>
          <a href="/" className="text-white/60 text-sm font-bold underline">Volver al juego</a>
        </div>
        <p role="alert" className="text-amber-300 font-bold text-sm empty:hidden">{msg}</p>
        {signedIn === false && <button className={`${BTN} self-start`} onClick={() => signInGoogle().catch(e => setMsg(e.message))}>Entrar con Google</button>}

        {data && <>
          <form className={`${CARD} flex flex-wrap items-end gap-3`} onSubmit={e => { e.preventDefault(); call({ op: 'limit', maxMembers: new FormData(e.currentTarget).get('max') }); }}>
            <label className="flex flex-col gap-1 text-sm font-bold">
              Personas por hogar (límite general)
              <input name="max" type="number" min={1} max={50} required defaultValue={data.maxMembers} key={data.maxMembers} className={NUM} />
            </label>
            <button className={BTN}>Guardar</button>
            <p className="basis-full text-white/50 text-xs">Se aplica al unirse con código. Bajarlo no expulsa a nadie que ya esté dentro.</p>
          </form>
          <form className={`${CARD} flex flex-wrap items-end gap-3`} onSubmit={e => { e.preventDefault(); call({ op: 'limit', maxHomes: new FormData(e.currentTarget).get('max') }); }}>
            <label className="flex flex-col gap-1 text-sm font-bold">
              Hogares por persona
              <input name="max" type="number" min={1} max={50} required defaultValue={data.maxHomes} key={data.maxHomes} className={NUM} />
            </label>
            <button className={BTN}>Guardar</button>
            <p className="basis-full text-white/50 text-xs">En cuántos hogares puede estar una misma cuenta (creados o por código). Bajarlo no saca a nadie de los que ya tiene.</p>
          </form>

          <h2 className="font-black text-lg">Hogares ({data.pets.length})</h2>
          {data.pets.map(p => (
            <div key={p.id} className={`${CARD} flex flex-col gap-2`}>
              <div className="flex items-baseline justify-between gap-2">
                <b className="text-lg">{p.name}</b>
                <span className="text-white/40 text-xs">{p.id} · activo {new Date(p.lastUpdated).toLocaleString('es')}</span>
              </div>
              <p className="text-sm text-white/80">
                {p.members.length} / {p.maxMembers ?? data.maxMembers} personas{p.members.length > 0 && ': '}
                {p.members.map(m => m.name + (m.owner ? ' 👑' : '')).join(', ')}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>Código: <b className="tracking-widest">{p.inviteCode ?? '— (sin código)'}</b></span>
                <button className={BTN} onClick={() => call({ op: 'code', petId: p.id })}>Código nuevo</button>
                <form className="flex items-center gap-2 ml-auto" onSubmit={e => { e.preventDefault(); call({ op: 'limit', petId: p.id, maxMembers: new FormData(e.currentTarget).get('max') }); }}>
                  <label className="text-white/60" htmlFor={`max-${p.id}`}>Límite propio</label>
                  <input id={`max-${p.id}`} name="max" type="number" min={1} max={50} placeholder="general" defaultValue={p.maxMembers ?? ''} key={p.maxMembers} className={NUM} />
                  <button className={BTN}>OK</button>
                </form>
              </div>
            </div>
          ))}
        </>}
      </div>
    </main>
  );
}
