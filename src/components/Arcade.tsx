'use client';
import { useEffect, useRef, useState } from 'react';
import { Film, LayoutGrid, CircleDot, Footprints, Cookie, X, ChevronLeft, ChevronRight, ArrowUp, ImagePlus, Link2, Trash2, Heart } from 'lucide-react';
import { PILL } from './CircularStats';
import { useIsland, listenCinema, setCinema, CINEMA_MAX, type Spot } from '@/store/islandStore';
import * as brick from '@/lib/brick';
import * as bounce from '@/lib/bounce';
import * as runner from '@/lib/runner';

// Lo que se hace en la isla de juegos: el cine y los tres minijuegos retro (canvas 2D de pocos píxeles ampliado
// sin suavizar), con la paleta de la isla y la pelota roja de Pocky. La lógica de los juegos está en lib/.

const SPOTS: { id: Spot; label: string; Icon: typeof Film; color: string }[] = [
  { id: 'cine', label: 'Cine', Icon: Film, color: '#c084fc' },
  { id: 'brick', label: 'Ladrillos', Icon: LayoutGrid, color: '#ff8fa3' },
  { id: 'bounce', label: 'Pelota', Icon: CircleDot, color: '#7cc8f0' },
  { id: 'run', label: 'Carrera', Icon: Footprints, color: '#ffd166' },
];
const CHIP = `${PILL} pointer-events-auto rounded-full h-10 px-3.5 flex items-center gap-1.5 text-white font-extrabold text-sm active:scale-95 transition-transform`;

/** Fila sobre el dock, solo cuando Pocky está en la isla de juegos: abrir el cine o un juego. (A casa se vuelve con el botón del dock.) */
export function IslandBar() {
  const there = useIsland(s => s.there);
  if (!there) return null;
  return (
    <div className="flex flex-wrap justify-center gap-1.5 px-2">
      {SPOTS.map(({ id, label, Icon, color }) => (
        <button key={id} className={CHIP} onClick={() => useIsland.setState({ open: id })}><Icon size={16} color={color} strokeWidth={2.6} aria-hidden />{label}</button>
      ))}
    </div>
  );
}

/** Pantallas completas de la isla (cine y juegos). También escucha lo que hay puesto en el cine de este hogar. */
export function IslandScreens({ petId }: { petId: string }) {
  const open = useIsland(s => s.open);
  useEffect(() => listenCinema(petId), [petId]);
  const close = () => useIsland.setState({ open: null });
  if (open === 'cine') return <CinemaPanel petId={petId} onClose={close} />;
  if (open === 'brick') return <BrickGame onClose={close} />;
  if (open === 'bounce') return <BounceGame onClose={close} />;
  if (open === 'run') return <RunnerGame onClose={close} />;
  return null;
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 bg-[#151a19] flex flex-col items-center px-[max(0.75rem,env(safe-area-inset-left))] pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md flex items-center justify-between">
        <h2 className="text-white font-black text-lg pl-2">{title}</h2>
        <button onClick={onClose} className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-transform" aria-label="Cerrar"><X size={22} color="#e5e7eb" strokeWidth={2.6} /></button>
      </div>
      {children}
    </div>
  );
}

// ---------- Cine ----------

/** Foto del móvil → JPEG reducido que quepa en el documento del cine (ver CINEMA_MAX). */
async function shrink(file: File) {
  const bmp = await createImageBitmap(file);
  for (const [side, q] of [[1280, 0.78], [1024, 0.6], [800, 0.45]]) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', q);
    if (url.length < CINEMA_MAX) return url;
  }
  throw new Error('La foto es demasiado grande.');
}
const isVideo = (url: string) => /\.(mp4|webm|mov|m4v|ogv)([?#]|$)/i.test(url);

function CinemaPanel({ petId, onClose }: { petId: string; onClose: () => void }) {
  const cinema = useIsland(s => s.cinema);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const put = async (make: () => Promise<{ url: string; kind: 'image' | 'video' } | null>) => {
    setBusy(true); setError('');
    try {
      const c = await make();
      await setCinema(petId, c && { ...c, by: localStorage.getItem('pocky_name') ?? '', at: Date.now() });
    } catch (e) { setError((e as { code?: string }).code === 'permission-denied' ? 'No tienes permiso para cambiar el cine.' : (e as Error).message || 'No se pudo guardar.'); }
    setBusy(false);
  };
  const BTN = 'rounded-xl bg-white/10 text-white font-extrabold text-sm px-3 py-2.5 flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40';
  return (
    <Shell title="Cine" onClose={onClose}>
      <div className="w-full max-w-md flex-1 min-h-0 flex flex-col gap-3">
        <div className="flex-1 min-h-0 rounded-2xl bg-black flex items-center justify-center overflow-hidden">
          {!cinema ? <p className="text-white/50 text-sm px-6 text-center">La pantalla está vacía. Pon una foto o un vídeo y lo verá todo el hogar.</p>
            // eslint-disable-next-line @next/next/no-img-element -- es una foto del usuario (data: o enlace externo), no un recurso de la app
            : cinema.kind === 'image' ? <img src={cinema.url} alt="En el cine" className="max-w-full max-h-full object-contain" draggable={false} />
              : <video key={cinema.url} src={cinema.url} className="max-w-full max-h-full" controls autoPlay loop playsInline />}
        </div>
        {cinema?.by && <p className="text-white/50 text-xs text-center -my-1">La puso {cinema.by}</p>}
        <div className="grid grid-cols-2 gap-2">
          <label className={`${BTN} ${busy ? 'opacity-40 pointer-events-none' : ''}`}>
            <ImagePlus size={17} className="text-sky-300" aria-hidden />Subir foto
            <input type="file" accept="image/*" className="hidden" disabled={busy}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) put(async () => ({ url: await shrink(f), kind: 'image' })); }} />
          </label>
          <button className={BTN} disabled={busy || !cinema} onClick={() => put(async () => null)}><Trash2 size={17} className="text-rose-300" aria-hidden />Quitar</button>
        </div>
        <form className="flex gap-2" onSubmit={e => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem('url') as HTMLInputElement, url = input.value.trim();
          if (!/^https:\/\//i.test(url)) return setError('El enlace tiene que empezar por https://');
          put(async () => ({ url, kind: isVideo(url) ? 'video' : 'image' })).then(() => { input.value = ''; });
        }}>
          <input name="url" type="url" inputMode="url" placeholder="Enlace a una imagen o un vídeo (.mp4)" aria-label="Enlace a una imagen o un vídeo"
            className="select-text min-w-0 flex-1 rounded-xl bg-white/10 text-white text-base px-3 py-2 outline-none focus:ring-2 focus:ring-[#ff9f43]" />
          <button className={BTN} disabled={busy}><Link2 size={17} className="text-emerald-300" aria-hidden />Poner</button>
        </form>
        <p role="status" className="text-rose-300 text-sm text-center min-h-5">{error}</p>
      </div>
    </Shell>
  );
}

// ---------- Juegos: canvas retro ----------

const SKY = '#bfe6f7', LINE = '#8e4e2e', DIRT = '#b8805a', GRASS = '#8fca55', GRASS_HI = '#b5e07a', RED = '#ff5c5c';
const BRICK_COLORS = ['', '#ff8fa3', '#ffd166', '#a3d466', '#7cc8f0', '#c6a4ea'];

/** Bucle de dibujo: llama a `frame(ctx, dt)` en cada fotograma con el canvas a su resolución retro. */
function useCanvas(w: number, h: number, frame: (ctx: CanvasRenderingContext2D, dt: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null), fn = useRef(frame);
  useEffect(() => { fn.current = frame; });
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    let raf = 0, last = performance.now();
    const loop = (t: number) => { fn.current(ctx, Math.min((t - last) / 1000, 0.05)); last = t; raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return { ref, width: w, height: h, style: { imageRendering: 'pixelated', aspectRatio: `${w} / ${h}`, touchAction: 'none' } as React.CSSProperties };
}
const px = (ctx: CanvasRenderingContext2D, c: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
/** Óvalo de píxeles, fila a fila. */
function oval(ctx: CanvasRenderingContext2D, c: string, cx: number, cy: number, rx: number, ry: number) {
  for (let y = -ry; y < ry; y++) { const half = Math.round(rx * Math.sqrt(1 - ((y + 0.5) / ry) ** 2)); if (half > 0) px(ctx, c, cx - half, cy + y, half * 2, 1); }
}
/** Círculo de píxeles (filas de ancho decreciente) con un brillo: la pelota de Pocky. */
function ball(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  for (let y = -r; y < r; y++) { const half = Math.round(Math.sqrt(r * r - (y + 0.5) ** 2)); px(ctx, y >= -1 && y < 1 && r > 3 ? '#ffffff' : RED, cx - half, cy + y, half * 2, 1); }
  px(ctx, '#ffd0d0', cx - r / 2, cy - r / 2 - 1, Math.max(1, r / 3), Math.max(1, r / 3));
}
const clouds = (ctx: CanvasRenderingContext2D, w: number, shift: number) => [[10, 14, 22], [70, 30, 16], [150, 10, 26], [210, 26, 18]].forEach(([x, y, cw]) => {
  const cx = ((x - shift) % (w + 40) + w + 40) % (w + 40) - 20;
  px(ctx, '#ffffff', cx, y, cw, 4); px(ctx, '#ffffff', cx + 4, y - 3, cw - 9, 3);
});
function Hearts({ n }: { n: number }) {
  return <span className="flex gap-0.5" aria-label={`${n} vidas`}>{[0, 1, 2].map(i => <Heart key={i} size={16} color="#ff5c7a" fill={i < n ? '#ff5c7a' : 'none'} />)}</span>;
}
const END = 'absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#151a19]/75 text-white text-center';
const AGAIN = 'rounded-xl bg-[#ff9f43] text-[#151a19] font-black px-5 py-2.5 active:scale-95 transition-transform';

function BrickGame({ onClose }: { onClose: () => void }) {
  const g = useRef(brick.newBrick());
  const [hud, setHud] = useState({ score: 0, lives: 3, level: 0, over: false, stuck: true });
  const canvas = useCanvas(brick.W, brick.H, (ctx, dt) => {
    const s = g.current, { W, H, COLS, BW, BH, TOP, PW, PY } = brick;
    brick.stepBrick(s, dt);
    if (s.score !== hud.score || s.lives !== hud.lives || s.level !== hud.level || s.over !== hud.over || s.stuck !== hud.stuck) setHud({ score: s.score, lives: s.lives, level: s.level, over: s.over, stuck: s.stuck });
    px(ctx, SKY, 0, 0, W, H);
    px(ctx, '#5db7e6', 0, H - 6, W, 6); px(ctx, '#9fd8f2', 0, H - 6, W, 1); // el mar: si cae ahí, pierde una vida
    s.bricks.forEach((b, i) => {
      if (!b) return;
      const x = (i % COLS) * BW, y = TOP + Math.floor(i / COLS) * BH;
      px(ctx, LINE, x, y, BW - 1, BH - 1); px(ctx, BRICK_COLORS[b], x + 1, y + 1, BW - 3, BH - 3); px(ctx, '#ffffff99', x + 1, y + 1, BW - 3, 1);
    });
    px(ctx, LINE, s.px - PW / 2, PY, PW, 5); px(ctx, '#b4743f', s.px - PW / 2 + 1, PY + 1, PW - 2, 3); px(ctx, '#d79a62', s.px - PW / 2 + 1, PY + 1, PW - 2, 1); // pala: un tablón
    ball(ctx, Math.round(s.x), Math.round(s.y), 3);
  });
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); g.current.px = ((e.clientX - r.left) / r.width) * brick.W; };
  return (
    <Shell title="Ladrillos" onClose={onClose}>
      <div className="w-full max-w-md flex items-center justify-between px-2 pb-2 text-white font-extrabold">
        <span>{hud.score} pts</span><span className="text-white/50">Nivel {hud.level + 1}</span><Hearts n={hud.lives} />
      </div>
      <div className="relative flex-1 min-h-0 w-full flex justify-center">
        <canvas {...canvas} className="h-full max-w-full rounded-xl" onPointerDown={move} onPointerMove={move} onPointerUp={() => brick.launch(g.current)} />
        {hud.over && <div className={END}><p className="font-black text-2xl">¡Al agua!</p><p className="text-white/70 font-bold">{hud.score} puntos</p><button className={AGAIN} onClick={() => { g.current = brick.newBrick(); }}>Otra vez</button></div>}
      </div>
      <p className="text-white/50 text-sm font-bold pt-2 h-7">{hud.stuck && !hud.over ? 'Desliza para mover la pala y suelta para sacar' : ''}</p>
    </Shell>
  );
}

function BounceGame({ onClose }: { onClose: () => void }) {
  const g = useRef(bounce.newBounce()), input = useRef({ dir: 0, jump: false }), t = useRef(0);
  const [hud, setHud] = useState({ level: 0, left: 0, deaths: 0, won: false });
  const canvas = useCanvas(bounce.VW, bounce.VH, (ctx, dt) => {
    const s = g.current, { T, VW, VH, R } = bounce;
    bounce.stepBounce(s, input.current, dt);
    t.current += dt;
    const left = s.got.filter(x => !x).length;
    if (s.level !== hud.level || left !== hud.left || s.deaths !== hud.deaths || s.won !== hud.won) setHud({ level: s.level, left, deaths: s.deaths, won: s.won });
    const cam = Math.round(Math.max(0, Math.min(s.w * T - VW, s.x - VW / 2)));
    px(ctx, SKY, 0, 0, VW, VH);
    clouds(ctx, VW, cam * 0.2);
    for (let x = 0; x < VW; x += 2) px(ctx, '#a9dc8c', x, VH - 40 - Math.round(12 * Math.sin((x + cam * 0.4) / 31) + 6 * Math.sin((x + cam * 0.4) / 13)), 2, 60); // colinas al fondo
    px(ctx, '#5db7e6', 0, VH - 9, VW, 9); px(ctx, '#9fd8f2', 0, VH - 9, VW, 1); // agua en los huecos del suelo
    for (let r = 0; r < s.map.length; r++) for (let c = Math.floor(cam / T); c <= Math.floor((cam + VW) / T); c++) {
      const ch = s.map[r][c], x = c * T - cam, y = r * T;
      if (ch === '#') {
        px(ctx, DIRT, x, y, T, T); px(ctx, '#a06c48', x + 3, y + 9, 2, 2); px(ctx, '#a06c48', x + 11, y + 5, 2, 2);
        if (s.map[r - 1]?.[c] !== '#') { px(ctx, GRASS, x, y, T, 5); px(ctx, GRASS_HI, x, y, T, 1); px(ctx, LINE, x, y + 5, T, 1); }
      } else if (ch === '^') for (let i = 0; i < 8; i++) { px(ctx, '#cfc4b4', x + i, y + T - 1 - i, 2, i + 1); px(ctx, '#cfc4b4', x + 14 - i, y + T - 1 - i, 2, i + 1); px(ctx, LINE, x + i, y + T - 2 - i, 1, 1); px(ctx, LINE, x + 15 - i, y + T - 2 - i, 1, 1); }
    }
    s.cookies.forEach(([cx, cy], i) => { // galletas, flotando
      if (s.got[i]) return;
      const x = cx - cam, y = cy + Math.round(Math.sin(t.current * 4 + i) * 1.5);
      px(ctx, LINE, x - 3, y - 4, 6, 8); px(ctx, LINE, x - 4, y - 3, 8, 6); px(ctx, '#e8b96a', x - 3, y - 3, 6, 6); px(ctx, LINE, x - 2, y - 2, 1, 1); px(ctx, LINE, x + 1, y, 1, 1); px(ctx, LINE, x - 1, y + 2, 1, 1);
    });
    const [ex, ey] = s.exit, fx = ex - cam, open = left === 0; // banderín: gris hasta tener todas las galletas
    px(ctx, LINE, fx - 1, ey - 16, 2, 24);
    for (let i = 0; i < 5; i++) px(ctx, open ? '#ff8fa3' : '#b9c0c8', fx + 1, ey - 16 + i, 10 - i * 2, 1), px(ctx, open ? '#ff8fa3' : '#b9c0c8', fx + 1, ey - 7 - i, 10 - i * 2, 1);
    ball(ctx, Math.round(s.x) - cam, Math.round(s.y), R);
  });
  useEffect(() => { // teclado (ordenador): flechas y espacio
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const d = e.key === 'ArrowLeft' ? -1 : 1; if (down) input.current.dir = d; else if (input.current.dir === d) input.current.dir = 0; }
      if (e.key === 'ArrowUp' || e.key === ' ') input.current.jump = down;
    };
    const kd = key(true), ku = key(false);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);
  // Botones táctiles: apretado = activo. Cada uno captura su dedo, así se puede andar y saltar a la vez.
  const hold = (on: () => void, off: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); on(); },
    onPointerUp: off, onPointerCancel: off, onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const PAD = `${PILL} rounded-2xl h-16 flex items-center justify-center active:brightness-150 touch-none`;
  return (
    <Shell title="Pelota" onClose={onClose}>
      <div className="w-full max-w-md flex items-center justify-between px-2 pb-2 text-white font-extrabold">
        <span>Nivel {hud.level + 1}/{bounce.LEVELS.length}</span><span className="text-[#e8b96a]">{hud.left ? `Faltan ${hud.left} galletas` : '¡Al banderín!'}</span>
      </div>
      <div className="relative w-full max-w-md">
        <canvas {...canvas} className="w-full rounded-xl" />
        {hud.won && <div className={`${END} rounded-xl`}><p className="font-black text-2xl">¡Completado!</p><p className="text-white/70 font-bold">{hud.deaths ? `Con ${hud.deaths} tropiezos` : 'Sin un solo tropiezo'}</p><button className={AGAIN} onClick={() => { g.current = bounce.newBounce(); }}>Otra vez</button></div>}
      </div>
      <div className="w-full max-w-md grid grid-cols-[1fr_1fr_1.4fr] gap-2 pt-4">
        <button className={PAD} aria-label="Izquierda" {...hold(() => { input.current.dir = -1; }, () => { if (input.current.dir === -1) input.current.dir = 0; })}><ChevronLeft size={30} color="#e5e7eb" strokeWidth={3} /></button>
        <button className={PAD} aria-label="Derecha" {...hold(() => { input.current.dir = 1; }, () => { if (input.current.dir === 1) input.current.dir = 0; })}><ChevronRight size={30} color="#e5e7eb" strokeWidth={3} /></button>
        <button className={PAD} aria-label="Saltar" {...hold(() => { input.current.jump = true; }, () => { input.current.jump = false; })}><ArrowUp size={30} color="#ff9f43" strokeWidth={3} /></button>
      </div>
    </Shell>
  );
}

// ---------- Carrera: Pocky visto de espaldas por un camino de tres carriles en perspectiva ----------

const RW = 120, RH = 168, HORIZON = 54, FEET = 146, LANE = 26; // píxeles: horizonte, línea de los pies y ancho de carril a sus pies
const FUR = '#efd6ab', FUR_DARK = '#d9bb8a', PINK = '#efaab3';
/** Tamaño aparente a `z` pasos por delante (1 a sus pies, 0 en el horizonte). */
const depth = (z: number) => 1 / (1 + Math.max(z, -3) * 0.06);

function RunnerGame({ onClose }: { onClose: () => void }) {
  const g = useRef(runner.newRunner()), t = useRef(0), swipe = useRef<[number, number] | null>(null);
  const [hud, setHud] = useState({ score: 0, cookies: 0, over: false, best: 0 });
  useEffect(() => { setHud(h => ({ ...h, best: Number(localStorage.getItem('pocky_run_best')) || 0 })); }, []);
  const canvas = useCanvas(RW, RH, (ctx, dt) => {
    const s = g.current;
    runner.stepRunner(s, dt);
    if (!s.over) t.current += dt;
    const sc = runner.score(s);
    if (sc !== hud.score || s.cookies !== hud.cookies || s.over !== hud.over) {
      const best = Math.max(hud.best, s.over ? sc : 0);
      if (best > hud.best) localStorage.setItem('pocky_run_best', String(best));
      setHud({ score: sc, cookies: s.cookies, over: s.over, best });
    }
    // Fondo: cielo, mar y colinas en el horizonte; hierba; el camino, línea a línea (franjas que corren hacia la cámara).
    px(ctx, SKY, 0, 0, RW, HORIZON);
    clouds(ctx, RW, t.current * 2);
    px(ctx, '#5db7e6', 0, HORIZON - 8, RW, 8);
    for (let x = 0; x < RW; x += 2) px(ctx, '#7fbf5a', x, HORIZON - 3 - Math.round(4 * Math.sin(x / 17) + 2 * Math.sin(x / 7)), 2, 12);
    for (let y = HORIZON; y < RH; y++) {
      const k = (y - HORIZON + 0.5) / (FEET - HORIZON), band = Math.floor((1 / k - 1) / 0.06 / 7 + s.dist / 7) & 1, half = Math.round(LANE * 1.6 * k);
      px(ctx, band ? GRASS : '#86c24e', 0, y, RW, 1);
      px(ctx, LINE, RW / 2 - half - 1, y, half * 2 + 2, 1);
      px(ctx, band ? '#f0c88c' : '#e8bd7e', RW / 2 - half, y, half * 2, 1);
      if (band) for (const side of [-1, 1]) px(ctx, '#d2a468', RW / 2 + side * LANE * 0.5 * k, y, 1, 1); // rayas entre carriles
    }
    // De lejos a cerca: árboles a los lados (cada 20 pasos), obstáculos y galletas.
    const items: { z: number; lane: number; draw: (x: number, y: number, k: number) => void }[] = [];
    for (let z = 20 - (s.dist % 20); z < runner.FAR; z += 20) for (const side of [-2.5, 2.5]) items.push({ z, lane: side, draw: (x, y, k) => {
      px(ctx, '#9c6142', x - 2 * k, y - 16 * k, Math.ceil(4 * k), Math.ceil(16 * k));
      oval(ctx, '#5aa846', x, y - 22 * k, Math.ceil(11 * k), Math.ceil(10 * k)); oval(ctx, '#7cc152', x - 2 * k, y - 25 * k, Math.ceil(7 * k), Math.ceil(6 * k));
    } });
    for (const o of s.things) if (!o.taken) items.push({ z: o.z - s.dist, lane: o.lane, draw: (x, y, k) => {
      if (o.kind === 'rock') { oval(ctx, LINE, x, y - 8 * k, Math.ceil(10 * k) + 1, Math.ceil(9 * k) + 1); oval(ctx, '#cfc4b4', x, y - 8 * k, Math.ceil(10 * k), Math.ceil(9 * k)); oval(ctx, '#e6ddd0', x - 3 * k, y - 11 * k, Math.ceil(4 * k), Math.ceil(3 * k)); }
      else if (o.kind === 'log') { px(ctx, LINE, x - 12 * k - 1, y - 7 * k - 1, Math.ceil(24 * k) + 2, Math.ceil(7 * k) + 2); px(ctx, '#a86f42', x - 12 * k, y - 7 * k, Math.ceil(24 * k), Math.ceil(7 * k)); px(ctx, '#c98a55', x - 12 * k, y - 7 * k, Math.ceil(24 * k), Math.max(1, Math.round(2 * k))); }
      else { const cy = y - 9 * k + Math.sin(t.current * 5 + o.z) * 1.5 * k; oval(ctx, LINE, x, cy, Math.ceil(4 * k) + 1, Math.ceil(4 * k) + 1); oval(ctx, '#e8b96a', x, cy, Math.ceil(4 * k), Math.ceil(4 * k)); if (k > 0.5) { px(ctx, LINE, x - 2, cy - 1, 1, 1); px(ctx, LINE, x + 1, cy + 1, 1, 1); } }
    } });
    items.sort((a, b) => b.z - a.z).forEach(({ z, lane, draw }) => { if (z < runner.FAR && z > -3) { const k = depth(z); draw(Math.round(RW / 2 + lane * LANE * k), Math.round(HORIZON + (FEET - HORIZON) * k), k); } });
    // Pocky de espaldas: sombra, patas que alternan, cuerpo, cola meciéndose y cabeza con orejas.
    const x = Math.round(RW / 2 + s.x * LANE), y = Math.round(FEET - s.y * 2.5), step = Math.sin(t.current * 16) > 0 ? 1 : 0, air = s.y > 0;
    oval(ctx, '#00000033', x, FEET + 1, Math.max(4, 9 - Math.round(s.y)), 2);
    for (const [side, up] of [[-1, step], [1, 1 - step]]) { px(ctx, LINE, x + side * 4 - 2, y - 5 - (air ? 2 : up * 2), 4, 6); px(ctx, FUR_DARK, x + side * 4 - 1, y - 4 - (air ? 2 : up * 2), 2, 4); }
    oval(ctx, LINE, x, y - 11, 9, 8); oval(ctx, FUR, x, y - 11, 8, 7);
    const sway = Math.round(Math.sin(t.current * 8) * 2);
    for (let i = 0; i < 9; i++) px(ctx, i > 6 ? FUR_DARK : LINE, x + Math.round((sway * i) / 8) - 1, y - 12 - i, 3, 1); // cola
    for (let i = 1; i < 8; i++) px(ctx, FUR, x + Math.round((sway * i) / 8), y - 12 - i, 1, 1);
    for (const side of [-1, 1]) for (let i = 0; i < 5; i++) { px(ctx, LINE, x + side * 6 - i / 2 - 1, y - 30 + i, i + 2, 1); if (i > 1) px(ctx, PINK, x + side * 6 - (i - 2) / 2, y - 30 + i, i - 1, 1); } // orejas
    oval(ctx, LINE, x, y - 21, 9, 7); oval(ctx, FUR, x, y - 21, 8, 6);
  });
  const again = () => { g.current = runner.newRunner(); t.current = 0; };
  useEffect(() => { // teclado (ordenador): flechas y espacio
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') runner.steer(g.current, -1); else if (e.key === 'ArrowRight') runner.steer(g.current, 1);
      else if (e.key === 'ArrowUp' || e.key === ' ') runner.jump(g.current);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // Deslizar a un lado cambia de carril; deslizar hacia arriba (o un toque) salta. Se decide al mover, sin esperar a soltar.
  const down = (e: React.PointerEvent) => { swipe.current = [e.clientX, e.clientY]; };
  const move = (e: React.PointerEvent) => {
    if (!swipe.current) return;
    const dx = e.clientX - swipe.current[0], dy = e.clientY - swipe.current[1];
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    if (Math.abs(dx) > Math.abs(dy)) runner.steer(g.current, Math.sign(dx)); else if (dy < 0) runner.jump(g.current);
    swipe.current = null;
  };
  const up = () => { if (swipe.current) runner.jump(g.current); swipe.current = null; };
  return (
    <Shell title="Carrera" onClose={onClose}>
      <div className="w-full max-w-md flex items-center justify-between px-2 pb-2 text-white font-extrabold">
        <span>{hud.score} pts</span><span className="text-white/50">Récord {hud.best}</span>
        <span className="flex items-center gap-1 text-[#e8b96a]"><Cookie size={16} aria-hidden />{hud.cookies}</span>
      </div>
      <div className="relative flex-1 min-h-0 w-full flex justify-center">
        <canvas {...canvas} className="h-full max-w-full rounded-xl" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { swipe.current = null; }} />
        {hud.over && <div className={END}><p className="font-black text-2xl">¡Tropezón!</p><p className="text-white/70 font-bold">{hud.score} puntos · récord {hud.best}</p><button className={AGAIN} onClick={again}>Otra vez</button></div>}
      </div>
      <p className="text-white/50 text-sm font-bold pt-2 text-center">Desliza a los lados para esquivar; arriba para saltar</p>
    </Shell>
  );
}
