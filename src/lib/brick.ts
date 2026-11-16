// Rompeladrillos de la isla de juegos: lógica pura (sin React ni canvas), así la comprueba `npm run check`.
// Unidades: píxeles de una pantalla retro de W × H; el canvas se amplía con CSS.
export const W = 120, H = 168, COLS = 8, BW = 15, BH = 8, TOP = 16, PW = 26, PY = H - 14, R = 2.5;

// Un carácter por ladrillo: '.' hueco, 1-5 color. Al acabar los tres se repiten más rápido.
export const LEVELS = [
  ['........', '11111111', '22222222', '33333333', '44444444'],
  ['1.1..1.1', '.2.22.2.', '33.33.33', '.4.44.4.', '5.5..5.5', '.1.11.1.'],
  ['...11...', '..2222..', '.333333.', '44444444', '.555555.', '..1111..', '...22...'],
];

export type Brick = {
  px: number; x: number; y: number; vx: number; vy: number; // pala (centro) y pelota
  stuck: boolean; // pelota pegada a la pala, esperando el saque
  bricks: number[]; lives: number; score: number; level: number; over: boolean;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const speed = (level: number) => 85 + 12 * Math.min(level, 8);

export const newBrick = (level = 0, score = 0, lives = 3): Brick => ({
  px: W / 2, x: W / 2, y: PY - R, vx: 0, vy: 0, stuck: true, lives, score, level, over: false,
  bricks: LEVELS[level % LEVELS.length].flatMap(row => [...row.padEnd(COLS, '.')].map(ch => (ch === '.' ? 0 : +ch))),
});

/** Saque: la pelota sale de la pala hacia arriba, algo ladeada. */
export function launch(g: Brick) {
  if (!g.stuck || g.over) return;
  g.stuck = false;
  g.vx = speed(g.level) * 0.35;
  g.vy = -speed(g.level) * 0.94;
}

/** Avanza `dt` segundos (muta `g`). La pala la mueve quien llama, escribiendo `g.px`. */
export function stepBrick(g: Brick, dt: number) {
  g.px = clamp(g.px, PW / 2, W - PW / 2);
  if (g.over) return;
  if (g.stuck) { g.x = g.px; g.y = PY - R; return; }
  const s = speed(g.level), n = Math.ceil((s * dt) / 1.5), h = dt / n; // pasos de ≤1,5 px: no atraviesa ladrillos
  for (let i = 0; i < n; i++) {
    g.x += g.vx * h; g.y += g.vy * h;
    if (g.x < R) { g.x = R; g.vx = Math.abs(g.vx); }
    if (g.x > W - R) { g.x = W - R; g.vx = -Math.abs(g.vx); }
    if (g.y < R) { g.y = R; g.vy = Math.abs(g.vy); }
    // Pala: según dónde pegue sale más o menos ladeada (hasta 60°), siempre a la misma velocidad.
    if (g.vy > 0 && g.y + R >= PY && g.y + R <= PY + 5 && Math.abs(g.x - g.px) <= PW / 2 + R) {
      const a = clamp((g.x - g.px) / (PW / 2), -1, 1) * 1.05;
      g.vx = s * Math.sin(a); g.vy = -s * Math.cos(a); g.y = PY - R;
    }
    if (g.y > H + R) { // se fue al agua
      if (--g.lives <= 0) g.over = true; else g.stuck = true;
      return;
    }
    const c0 = Math.floor(g.x / BW), r0 = Math.floor((g.y - TOP) / BH);
    hit: for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= COLS || r < 0 || !g.bricks[r * COLS + c]) continue;
      const bx = c * BW, by = TOP + r * BH, dx = g.x - clamp(g.x, bx, bx + BW - 1), dy = g.y - clamp(g.y, by, by + BH - 1);
      if (dx * dx + dy * dy >= R * R) continue;
      g.bricks[r * COLS + c] = 0;
      g.score += 10;
      if (Math.abs(dx) > Math.abs(dy)) g.vx = Math.sign(dx) * Math.abs(g.vx); else g.vy = (Math.sign(dy) || -Math.sign(g.vy)) * Math.abs(g.vy);
      break hit;
    }
    if (g.bricks.every(b => !b)) { Object.assign(g, newBrick(g.level + 1, g.score + 100, g.lives)); return; }
  }
}
