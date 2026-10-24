// Grafo de caminos de la isla: Pocky solo anda en línea recta entre nodos conectados.
// ponytail: waypoints a mano en vez de navmesh; si la isla crece, añadir nodos/aristas aquí.
export type XZ = readonly [number, number];

export const NODES = {
  s2: [-2.8, 6.0], s: [-1.8, 3.8], c: [0, -0.5], n: [0.5, -4.0], n2: [0.6, -6.2],
  door: [-5.3, -0.9], meds: [-4.38, -0.72], garden: [-5.5, 1.4], meadow: [-4.5, 3.5],
  field: [2.0, 0.6], bath: [1.9, 1.9], southR: [4.5, 5.6],
  picnic: [2.6, -2.4], play: [4.3, -0.2], fire: [5.1, -0.9], bed: [7.5, -0.4], bowl: [7.6, 0.8],
} as const satisfies Record<string, XZ>;

export type NodeId = keyof typeof NODES;

export const EDGES: [NodeId, NodeId][] = [
  ['s2', 's'], ['s', 'c'], ['c', 'n'], ['n', 'n2'], ['c', 'door'], ['door', 'meds'], ['door', 'garden'],
  ['garden', 'meadow'], ['meadow', 's'], ['meadow', 'c'], ['s', 'field'], ['c', 'field'],
  ['field', 'bath'], ['s', 'southR'], ['c', 'picnic'], ['picnic', 'play'], ['field', 'play'],
  ['play', 'fire'], ['fire', 'bed'], ['bed', 'bowl'], ['play', 'bowl'],
];

// Sitios a los que va cada acción, y hacia dónde mira al llegar.
export const POI = {
  eat: { node: 'bowl', face: [8.3, 1.0] },
  bath: { node: 'bath', face: [3.8, 3.4] },
  play: { node: 'play', face: [4.3, 3] },
  sleep: { node: 'bed', face: [6.5, 1.5] },
  heal: { node: 'meds', face: [-4.38, -1.62] }, // botiquín en la pared de la casa, a la derecha de la puerta
} as const satisfies Record<string, { node: NodeId; face: XZ }>;

// Claros donde puede caer una golosina: ≥1.4 libres de casa, estanque, árboles, vallas y borde de la isla
// (la golosina se desvía ≤0.35 del nodo y Pocky se para a 0.8 de ella).
export const TREAT_SPOTS: NodeId[] = ['s', 'c', 'field', 'meadow', 'play'];

// Claros de césped donde aparecen las cacas (petLogic guarda el índice): lejos de caminos, aristas, árboles,
// arbustos, rocas, casa y estanques. Elegidos con un barrido de la isla; `npm run check` comprueba lo básico.
export const POOP_XZ: XZ[] = [[-1.75, -3], [0, 5.75], [7, -1.5], [-6.25, 3.5], [2.75, 1.25]];

export const WANDER: NodeId[] = ['s2', 's', 'c', 'n2', 'garden', 'meadow', 'field', 'southR', 'picnic', 'play', 'door'];
export const TOUR: NodeId[] = ['n2', 's2', 'meadow', 'c'];

const dist = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function nearestNode(p: XZ): NodeId {
  let best: NodeId = 'c';
  for (const id of Object.keys(NODES) as NodeId[]) if (dist(p, NODES[id]) < dist(p, NODES[best])) best = id;
  return best;
}

// Dijkstra O(n²): con 16 nodos sobra.
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
