// "Carrera" de la isla de juegos: Pocky corre sin parar por un camino de tres carriles, esquiva rocas (cambiando
// de carril), salta troncos y recoge galletas; cada vez más rápido. Lógica pura (sin React ni canvas), así la
// comprueba `npm run check`. Unidades: distancia en "pasos" a lo largo del camino; carriles -1, 0 y 1.
export type Thing = { z: number; lane: number; kind: 'rock' | 'log' | 'cookie'; taken?: boolean };
export type Runner = {
  lane: number; x: number; // carril al que va y posición real (se desliza de uno a otro)
  y: number; vy: number; // altura del salto
  dist: number; speed: number; things: Thing[]; nextRow: number; cookies: number; over: boolean; seed: number;
};

export const FAR = 120; // hasta dónde se ve (y se generan) las filas de obstáculos
const JUMP = 40, GRAVITY = 130, LOG_H = 5, SLIDE = 8; // salta ~6 de alto en 0,6 s; un tronco mide 5; 8 carriles/s
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// Azar con semilla dentro del estado: la misma semilla da la misma carrera (para las comprobaciones).
const rand = (g: Runner) => (g.seed = (g.seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

export const newRunner = (seed = Math.floor(Math.random() * 1e9)): Runner =>
  ({ lane: 0, x: 0, y: 0, vy: 0, dist: 0, speed: 26, things: [], nextRow: 60, cookies: 0, over: false, seed });
export const steer = (g: Runner, d: number) => { if (!g.over) g.lane = clamp(g.lane + d, -1, 1); };
export const jump = (g: Runner) => { if (!g.over && g.y === 0) g.vy = JUMP; };
export const score = (g: Runner) => Math.floor(g.dist / 4) + g.cookies * 10;

/** Avanza `dt` segundos (muta `g`). */
export function stepRunner(g: Runner, dt: number) {
  if (g.over) return;
  g.speed = 26 + Math.min(g.dist / 60, 26);
  g.dist += g.speed * dt;
  g.x += clamp(g.lane - g.x, -SLIDE * dt, SLIDE * dt);
  if (g.y > 0 || g.vy > 0) {
    g.y += g.vy * dt; g.vy -= GRAVITY * dt;
    if (g.y <= 0) g.y = g.vy = 0;
  }
  // Filas nuevas a lo lejos: siempre queda un carril libre (a veces con galleta); en los otros, roca, tronco o nada.
  while (g.nextRow < g.dist + FAR) {
    const free = Math.floor(rand(g) * 3) - 1;
    for (const lane of [-1, 0, 1]) {
      const r = rand(g);
      if (lane === free) { if (r < 0.6) g.things.push({ z: g.nextRow, lane, kind: 'cookie' }); }
      else if (r < 0.7) g.things.push({ z: g.nextRow, lane, kind: r < 0.4 ? 'rock' : 'log' });
    }
    g.nextRow += Math.max(30, g.speed * 0.85) + rand(g) * 14; // más rápido, más separadas: siempre da tiempo a reaccionar
  }
  for (const t of g.things) {
    if (t.taken || Math.abs(t.z - g.dist) > 1.6 || Math.abs(t.lane - g.x) >= 0.5) continue;
    if (t.kind === 'cookie') { if (g.y < 9) { t.taken = true; g.cookies++; } }
    else if (t.kind === 'rock' || g.y < LOG_H) { g.over = true; return; } // la roca no se salta; el tronco sí
  }
  g.things = g.things.filter(t => t.z > g.dist - 8);
}
