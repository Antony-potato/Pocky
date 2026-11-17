import { timingSafeEqual } from 'node:crypto';
import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';
import { adminDb, widgetKey } from '@/lib/admin';
import { widgetView } from '@/lib/petLogic';
import type { PetData } from '@/types/pet';

/**
 * Widget de pantalla de inicio: GET /api/widget?pet=<id>&k=<clave>&s=small|medium → PNG con Pocky, qué le pasa y sus
 * barras. Lo piden las apps de widgets (Scriptable, KWGT), que no pueden iniciar sesión con Google: por eso va con la
 * clave del hogar en el enlace (lo da /api/home op 'widget', solo a sus miembros) y solo sirve para ver esta imagen.
 * El estado sale al minuto (`widgetView` aplica la degradación en memoria), no solo cada tick del cron.
 * Pocky son fotos de su modelo 3D (public/widget/<look>.png): no lleva los accesorios puestos.
 */
const BARS = ['#fb923c', '#4ade80', '#38bdf8', '#facc15', '#f87171'], LABELS = ['Hambre', 'Felicidad', 'Limpieza', 'Energía', 'Salud'];
const SCENE = { // cielo (arriba, abajo) y hierba
  ok: ['#6fc3f5', '#d6f1ff', '#8fce5a'],
  need: ['#ff9f43', '#ffe3bd', '#a9c75c'],
  sleep: ['#121a38', '#35457a', '#2c5b4b'],
};
const PANEL = 'rgba(21, 26, 25, 0.74)', TRACK = 'rgba(255, 255, 255, 0.18)';
let font: Promise<ArrayBuffer> | undefined; // la fuente se baja una vez por instancia

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams, id = q.get('pet') ?? '', k = Buffer.from(q.get('k') ?? '');
  if (!/^[\w-]{1,40}$/.test(id)) return new Response('Enlace no válido', { status: 401 });
  const key = Buffer.from(widgetKey(id));
  if (k.length !== key.length || !timingSafeEqual(k, key)) return new Response('Enlace no válido', { status: 401 });
  const snap = await adminDb().doc(`pets/${id}`).get();
  if (!snap.exists) return new Response('Hogar desconocido', { status: 404 });

  const v = widgetView(snap.data() as PetData), [top, bottom, grass] = SCENE[v.tone];
  const small = q.get('s') === 'small', W = small ? 510 : 1092, H = 510;
  const asset = (name: string) => new URL(`/widget/${name}`, req.url).href;
  font ??= fetch(asset('nunito-800.ttf')).then(r => r.arrayBuffer());
  const fill = (value: number, i: number) => ({ width: `${Math.max(value, 5)}%`, height: '100%', borderRadius: 99, background: value < 20 ? '#f87171' : value < 40 ? '#fb923c' : BARS[i] });
  const text = { fontSize: v.message.length > 26 ? (small ? 30 : 38) : small ? 38 : 46, lineHeight: 1.12 };
  const S = small ? 400 : 470; // lado de la foto de Pocky; dormido está tumbado: más abajo, que toque la hierba

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: `linear-gradient(${top}, ${bottom})`, fontFamily: 'Nunito', color: '#fff' }}>
        <div style={{ position: 'absolute', left: -W * 0.2, top: small ? 270 : 345, width: W * 1.4, height: 700, borderRadius: '50%', background: grass }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" src={asset(`${v.look}.png`)} width={S} height={S} style={{ position: 'absolute', left: small ? 55 : 8, top: (small ? -42 : 22) + (v.look === 'sleeping' ? 48 : 0) }} />
        {small ? (
          <div style={{ position: 'absolute', left: 26, right: 26, bottom: 26, display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px 22px', borderRadius: 34, background: PANEL }}>
            <div style={{ ...text, display: 'flex', justifyContent: 'center', textAlign: 'center' }}>{v.message}</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {v.bars.map((value, i) => (
                <div key={i} style={{ flex: 1, height: 14, display: 'flex', borderRadius: 99, background: TRACK }}><div style={fill(value, i)} /></div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ position: 'absolute', right: 34, top: 34, bottom: 34, width: 580, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '30px 36px 34px', borderRadius: 40, background: PANEL }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ ...text, display: 'flex' }}>{v.message}</div>
              {v.streak > 1 && <div style={{ display: 'flex', fontSize: 26, color: 'rgba(255, 255, 255, 0.6)' }}>{`Racha de ${v.streak} días`}</div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {v.bars.map((value, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ display: 'flex', width: 150, fontSize: 26, color: 'rgba(255, 255, 255, 0.78)' }}>{LABELS[i]}</div>
                  <div style={{ flex: 1, height: 18, display: 'flex', borderRadius: 99, background: TRACK }}><div style={fill(value, i)} /></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    ),
    { width: W, height: H, fonts: [{ name: 'Nunito', data: await font, weight: 800, style: 'normal' }], headers: { 'Cache-Control': 'no-store' } },
  );
}
