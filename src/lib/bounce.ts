// "Pelota saltarina" de la isla de juegos: la pelota de Pocky recorre niveles de plataformas, recoge todas las
// galletas y llega al banderín. Lógica pura (sin React ni canvas), así la comprueba `npm run check`.
// Unidades: píxeles de una pantalla retro; cada casilla mide T. El canvas se amplía con CSS.
export const T = 16, VW = 240, VH = 160, R = 6;
const SPEED = 75, ACCEL = 500, GRAVITY = 420, JUMP = 190, FALL_MAX = 300, REBOUND = 170;
// Con estos números: salta 2 casillas de alto y ~4 de largo. Los niveles se diseñan con eso (y un buscador de
// caminos comprobó que todas las galletas y el banderín se alcanzan).

// '#' suelo, '^' pinchos, 'o' galleta, 'P' salida, 'E' banderín. 10 filas; la de abajo es el suelo.
export const LEVELS: string[][] = [
  [
    '', '', '', '',
    '                     o',
    '                    ###',
    '         o      o               o',
    '        ###    ###             ###',
    ' P   o              ^   o   ^       o ^        E',
    '############  ############################  ######',
  ],
  [
    '', '', '',
    '                                 o',
    '                                ###',
    '            o          o',
    '           ###   ##   ###   ###              o',
    '      ##                               ##   ###',
    ' P  o     ^^     o        ^^    o   ^      o          E',
    '#########################  ########################  ####',
  ],
  [
    '', '', '',
    '                 o                         o',
    '                ###       o               ###',
    '          o              ###    ##   ##',
    '   o     ###   ##   ^          ^                  o',
    ' P     ^      ^   #####  o  ^^   ##   o     ^    ###     E',
    '######   ####   #########################  ####   ##  ####  ####',
  ],
];
// Las filas vacías de arriba se pueden omitir: se rellenan hasta 10.
const rowsOf = (level: number) => { const m = LEVELS[level]; return [...Array(10 - m.length).fill(''), ...m]; };

export type Bounce = {
  level: number; map: string[]; w: number; // casillas de ancho
  x: number; y: number; vx: number; vy: number; ground: boolean;
  start: [number, number]; exit: [number, number]; cookies: [number, number][]; got: boolean[]; // centros en píxeles
  deaths: number; won: boolean;
};
export type Input = { dir: number; jump: boolean };

export function newBounce(level = 0, deaths = 0): Bounce {
  const rows = rowsOf(level), w = Math.max(...rows.map(r => r.length)), map = rows.map(r => r.padEnd(w));
  const find = (ch: string) => map.flatMap((row, r) => [...row].flatMap((c, i): [number, number][] => (c === ch ? [[i * T + T / 2, r * T + T / 2]] : [])));
  const [start] = find('P'), [exit] = find('E'), cookies = find('o');
  return { level, map, w, x: start[0], y: start[1] + T / 2 - R, vx: 0, vy: 0, ground: false, start, exit, cookies, got: cookies.map(() => false), deaths, won: false };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// Los lados del nivel son pared; por arriba está abierto y por abajo se cae.
const solid = (g: Bounce, c: number, r: number) => c < 0 || c >= g.w || g.map[r]?.[c] === '#';

/** Avanza `dt` segundos (muta `g`). */
export function stepBounce(g: Bounce, input: Input, dt: number) {
  if (g.won) return;
  g.vx += clamp(input.dir * SPEED - g.vx, -ACCEL * dt, ACCEL * dt);
  if (input.jump && g.ground) { g.vy = -JUMP; g.ground = false; }
  g.vy = Math.min(g.vy + GRAVITY * dt, FALL_MAX);

  // Choques: la pelota como una caja de 2R × 2R, primero en horizontal y luego en vertical.
  const rows = () => [Math.floor((g.y - R) / T), Math.floor((g.y + R - 0.01) / T)], cols = () => [Math.floor((g.x - R) / T), Math.floor((g.x + R - 0.01) / T)];
  g.x += g.vx * dt;
  { const [r0, r1] = rows(), [c0, c1] = cols(), c = g.vx > 0 ? c1 : c0;
    if (g.vx !== 0) for (let r = r0; r <= r1; r++) if (solid(g, c, r)) { g.x = g.vx > 0 ? c * T - R : (c + 1) * T + R; g.vx = 0; break; } }
  g.y += g.vy * dt;
  g.ground = false;
  { const [r0, r1] = rows(), [c0, c1] = cols(), r = g.vy > 0 ? r1 : r0;
    for (let c = c0; c <= c1; c++) if (solid(g, c, r)) {
      if (g.vy > 0) {
        g.y = r * T - R;
        if (input.jump) g.vy = -JUMP; // botón apretado: encadena saltos
        else if (g.vy > REBOUND) g.vy *= -0.35; // caída fuerte: rebota un poco (es una pelota)
        else { g.vy = 0; g.ground = true; }
      } else { g.y = (r + 1) * T + R; g.vy = 0; }
      break;
    } }

  // Pinchos (la mitad de abajo de su casilla) y caer al vacío: vuelve a la salida, conservando las galletas.
  const spike = (c: number, r: number) => g.map[r]?.[c] === '^' && g.y + R - 2 > r * T + T / 2;
  const cL = Math.floor((g.x - R + 2) / T), cR = Math.floor((g.x + R - 2) / T), rB = Math.floor((g.y + R - 2) / T);
  if (spike(cL, rB) || spike(cR, rB) || g.y > g.map.length * T + 40) {
    g.deaths++;
    [g.x, g.y] = [g.start[0], g.start[1] + T / 2 - R]; g.vx = g.vy = 0;
    return;
  }
  g.cookies.forEach(([cx, cy], i) => { if (Math.hypot(g.x - cx, g.y - cy) < R + 5) g.got[i] = true; });
  if (g.got.every(Boolean) && Math.abs(g.x - g.exit[0]) < 10 && Math.abs(g.y - g.exit[1]) < 12) {
    if (g.level + 1 < LEVELS.length) Object.assign(g, newBounce(g.level + 1, g.deaths)); else g.won = true;
  }
}
