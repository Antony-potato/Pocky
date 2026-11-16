// Grafo de caminos de la isla: Pocky solo anda en línea recta entre nodos conectados.
// ponytail: waypoints a mano en vez de navmesh; si la isla crece, añadir nodos/aristas aquí.
export type XZ = readonly [number, number];

// Embarcadero de casa: dónde sale del borde de la isla y hacia dónde apunta. Todo lo del viaje en barca se mide
// en `k` = distancia a lo largo de esa línea: 0 borde de casa, K_A barca amarrada en casa, K_B barca amarrada en
// la isla de juegos, K_G centro de la isla de juegos (su embarcadero es el espejo del de casa).
export const PIER = { x: 6.063, z: 5.54, dx: 0.5452, dz: 0.8383 } as const;
export const K_A = 3.7, K_B = 14.9, K_G = 24, GAMES_R = 5; // las tablas llegan a k = 2.3 y a K_G - GAMES_R - 2.3
export const along = (k: number): XZ => [PIER.x + PIER.dx * k, PIER.z + PIER.dz * k];
export const sailK = (x: number, z: number) => (x - PIER.x) * PIER.dx + (z - PIER.z) * PIER.dz;
export const GAMES: XZ = along(K_G);
export const GAMES_SHORE = GAMES_R + 2.0; // radio al que la arena de la isla de juegos se mete en el agua (espuma del mar)
const games = (x: number, z: number): XZ => [GAMES[0] + x, GAMES[1] + z];
export const PIER_Y = -0.28, BOAT_Y = -1.16; // altura de las tablas y de la cubierta de la barca (la hierba está en 0)
// Dentro del estanque (elipse grande de PONDS en Island.tsx, algo encogida) se mete en el agua hasta la barriga.
export const POND_Y = -0.6;
/** Altura del suelo que pisa Pocky: hierba, fondo del estanque, tablas del embarcadero o la barca. */
export function groundY(x: number, z: number) {
  if (((x - 3.8) / 2.15) ** 2 + ((z - 3.4) / 1.25) ** 2 < 1) return POND_Y;
  const k = sailK(x, z);
  if (Math.abs((x - PIER.x) * PIER.dz - (z - PIER.z) * PIER.dx) > 1.2) return 0; // fuera de la línea de los embarcaderos: hierba
  if (k > K_A - 1.2 && k < K_B + 1.5) return BOAT_Y; // de popa a proa
  if (k > 0 && k < 0.4) return (PIER_Y * k) / 0.4; // la orilla de casa baja hasta las tablas
  return k >= 0.4 && k < K_G - GAMES_R - 0.1 ? PIER_Y : 0;
}
/** Centro de lo que acompaña a Pocky entre islas (sol con sus sombras, nubes, lluvia): casa → isla de juegos. */
export function skyCenter(x: number, z: number): XZ {
  const u = Math.max(0, Math.min(1, sailK(x, z) / (K_G - GAMES_R)));
  return [GAMES[0] * u, GAMES[1] * u];
}

export const NODES = {
  dock: along(-0.2), pier: along(1.9), boatA: along(K_A), boatB: along(K_B), gPier: along(K_G - GAMES_R - 1.9), gDock: along(K_G - GAMES_R + 0.3),
  gc: GAMES, g1: games(-2.9, 0.7), g2: games(0.5, 3.1), g3: games(3.0, -0.9), cine: games(1.0, -1.7), // plaza, los tres puestos y el cine
  s2: [-2.8, 6.0], s: [-1.8, 3.8], c: [0, -0.5], n: [0.5, -4.0], n2: [0.6, -6.2],
  door: [-5.3, -0.9], meds: [-4.38, -0.72], garden: [-5.5, 1.4], meadow: [-4.5, 3.5],
  field: [2.0, 0.6], bath: [1.9, 1.9], pond: [3.9, 3.2], southR: [4.5, 5.6], // pond: dentro del agua, solo para bañarse
  picnic: [2.6, -2.4], play: [4.3, -0.2], fire: [5.1, -0.9], bed: [7.5, -0.4], bowl: [7.6, 0.8],
} as const satisfies Record<string, XZ>;

export type NodeId = keyof typeof NODES;

export const EDGES: [NodeId, NodeId][] = [
  ['s2', 's'], ['s', 'c'], ['c', 'n'], ['n', 'n2'], ['c', 'door'], ['door', 'meds'], ['door', 'garden'],
  ['garden', 'meadow'], ['meadow', 's'], ['meadow', 'c'], ['s', 'field'], ['c', 'field'],
  ['field', 'bath'], ['bath', 'pond'], ['s', 'southR'], ['c', 'picnic'], ['picnic', 'play'], ['field', 'play'],
  ['play', 'fire'], ['fire', 'bed'], ['bed', 'bowl'], ['play', 'bowl'],
  // a la isla de juegos: embarcadero, barca (boatA → boatB es la travesía) y la otra isla
  ['southR', 'dock'], ['dock', 'pier'], ['pier', 'boatA'], ['boatA', 'boatB'], ['boatB', 'gPier'], ['gPier', 'gDock'], ['gDock', 'gc'],
  ['gc', 'g1'], ['gc', 'g2'], ['gc', 'g3'], ['g1', 'g2'], ['g2', 'g3'], ['gc', 'cine'],
];

// Sitios a los que va cada acción, y hacia dónde mira al llegar.
export const POI = {
  eat: { node: 'bowl', face: [8.3, 1.0] },
  bath: { node: 'pond', face: [3.9, 6] }, // se baña dentro del estanque, de cara a la cámara
  play: { node: 'play', face: [4.3, 3] },
  sleep: { node: 'bed', face: [6.5, 1.5] },
  heal: { node: 'meds', face: [-4.38, -1.62] }, // botiquín en la pared de la casa, a la derecha de la puerta
} as const satisfies Record<string, { node: NodeId; face: XZ }>;

// En la isla de juegos se juega a la pelota en la plaza (no vuelve a casa para jugar).
export const GAMES_PLAY = { node: 'gc', face: [GAMES[0], GAMES[1] + 2.5] } as const satisfies { node: NodeId; face: XZ };

// Claros donde puede caer una golosina: ≥1.4 libres de casa, estanque, árboles, vallas y borde de la isla
// (la golosina se desvía ≤0.35 del nodo y Pocky se para a 0.8 de ella).
export const TREAT_SPOTS: NodeId[] = ['s', 'c', 'field', 'meadow', 'play'];

// Claros de césped donde aparecen las cacas (petLogic guarda el índice): lejos de caminos, aristas, árboles,
// arbustos, rocas, casa y estanques. Elegidos con un barrido de la isla; `npm run check` comprueba lo básico.
export const POOP_XZ: XZ[] = [[-1.75, -3], [0, 5.75], [7, -1.5], [-6.25, 3.5], [2.75, 1.25]];

export const WANDER: NodeId[] = ['s2', 's', 'c', 'n2', 'garden', 'meadow', 'field', 'southR', 'picnic', 'play', 'door'];
// Pasear = ir en barca a la isla de juegos y recorrerla. Se queda por allí hasta que se le llama a casa (botón
// "Casa") o una acción le hace volver (comer, bañarse, dormir...).
export const TOUR: NodeId[] = ['g2', 'g3', 'cine', 'g1'];
export const GAMES_WANDER: NodeId[] = ['gc', 'g1', 'g2', 'g3', 'cine'];

const dist = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function nearestNode(p: XZ): NodeId {
  let best: NodeId = 'c';
  for (const id of Object.keys(NODES) as NodeId[]) if (id !== 'pond' && dist(p, NODES[id]) < dist(p, NODES[best])) best = id; // al agua solo va a bañarse
  return best;
}

// ---- Ir a un punto cualquiera (toque en el suelo). `ok(x, z)` dice dónde se puede pisar (lo ponen las islas). ----
type Ok = (x: number, z: number) => boolean;

/** Yendo recto de `a` a `b`, hasta dónde se puede pisar. Devuelve `b` (el mismo) si todo el tramo es pisable. */
export function reach(a: XZ, b: XZ, ok: Ok): XZ {
  const n = Math.ceil(dist(a, b) / 0.15);
  let last = a;
  for (let i = 1; i <= n; i++) {
    const q: XZ = i === n ? b : [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
    if (!ok(q[0], q[1])) return last;
    last = q;
  }
  return b;
}

/** Nodo por el que volver al grafo desde `from`: el más cercano al que se llega recto sin atravesar nada. */
export function entryNode(from: XZ, ok: Ok): NodeId {
  const ids = (Object.keys(NODES) as NodeId[]).filter(id => id !== 'pond').sort((p, q) => dist(from, NODES[p]) - dist(from, NODES[q]));
  return ids.find(id => reach(from, NODES[id], ok) === NODES[id]) ?? ids[0];
}

/**
 * Camino hasta un punto cualquiera: recto si no hay nada en medio; si no, por el grafo hasta el nodo más cercano
 * al punto y de ahí recto hasta donde se pueda pisar (si tocaron el agua o un árbol, se queda lo más cerca posible).
 * ponytail: el último tramo sale siempre del nodo más cercano, sin rodear obstáculos; si hiciera falta, una rejilla con A*.
 */
export function walkRoute(from: XZ, to: XZ, ok: Ok): XZ[] {
  const direct = reach(from, to, ok), node = nearestNode(to), end = reach(NODES[node], to, ok);
  if (dist(direct, to) <= dist(end, to) + 0.2) return [direct];
  return [...findPath(entryNode(from, ok), node).map(id => NODES[id]), end];
}

// Dijkstra O(n²): con una treintena de nodos sobra.
export function findPath(from: NodeId, to: NodeId): NodeId[] {
  const d = new Map<NodeId, number>([[from, 0]]);
  const prev = new Map<NodeId, NodeId>();
  const open = new Set<NodeId>(Object.keys(NODES) as NodeId[]);
  while (open.size) {
    let u: NodeId | null = null;
    for (const n of open) if (d.has(n) && (u === null || d.get(n)! < d.get(u)!)) u = n;
    if (u === null || u === to) break;
    open.delete(u);
    for (const [a, b] of EDGES) {
      const v = a === u ? b : b === u ? a : null;
      if (!v || !open.has(v)) continue;
      const alt = d.get(u)! + dist(NODES[u], NODES[v]);
      if (alt < (d.get(v) ?? Infinity)) { d.set(v, alt); prev.set(v, u); }
    }
  }
  const path: NodeId[] = [to];
  while (path[0] !== from) {
    const p = prev.get(path[0]);
    if (!p) return [to]; // inalcanzable: va directo
    path.unshift(p);
  }
  return path;
}
