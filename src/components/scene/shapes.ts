import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { rng, blob, smoothSlab } from './materials';

// Modelos procedurales de la isla: rocas facetadas, copas por matas, hierba en manojos, flores con pétalos...
// Se generan una vez al cargar el módulo y se dibujan con instancing. Casi todos llevan color por vértice
// (oclusión en pliegues, degradados) que el material multiplica por el color de cada instancia.

export type V3 = [number, number, number];
type RGB = [number, number, number];

const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (k: number) => { const s = Math.sin(k * 12.9898) * 43758.5453; return s - Math.floor(s); };
const hex = (h: string): RGB => new THREE.Color(h).toArray() as RGB; // lineal, como espera vertexColors

// Lista para fusionar: sin uv, no indexada y con color por vértice (uniforme si no lo trae).
function prep(g: THREE.BufferGeometry, rgb: RGB = [1, 1, 1]) {
  g.deleteAttribute('uv');
  const out = g.index ? g.toNonIndexed() : g;
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.color) out.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: out.attributes.position.count }, () => rgb).flat(), 3));
  return out;
}
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map(p => prep(p)))!;
const tinted = (g: THREE.BufferGeometry, h: string) => prep(g, hex(h));
// Recorre los vértices y pone el color que devuelva f(x, y, z).
function paint(g: THREE.BufferGeometry, f: (x: number, y: number, z: number) => number | RGB) {
  const p = g.attributes.position, c: number[] = [];
  for (let i = 0; i < p.count; i++) { const v = f(p.getX(i), p.getY(i), p.getZ(i)); c.push(...(typeof v === 'number' ? [v, v, v] : v)); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}
// Centra en x/z, apoya en y = 0 y escala a altura 1.
function normalize(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const b = g.boundingBox!, h = b.max.y - b.min.y;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(1 / h, 1 / h, 1 / h);
  g.computeBoundingBox();
  return g;
}

// Tubo que se estrecha de r0 a r1 a lo largo de una curva (troncos, ramas, raíces).
function tube(pts: V3[], r0: number, r1: number, seg = 8, radial = 7) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
  const fr = curve.computeFrenetFrames(seg, false), P: number[] = [], I: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const c = curve.getPointAt(i / seg), rr = r0 + (r1 - r0) * (i / seg), N = fr.normals[i], B = fr.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, k = rr * (1 + 0.06 * Math.sin(a * 3 + i));
      P.push(c.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * k, c.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * k, c.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * k);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    I.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

// ---------- Rocas ----------

// Esfera recortada por muchos planos (repartidos por arriba y los lados) con un mínimo suave estrecho: caras
// planas bien visibles y cantos gastados. Cada cara con un tono algo distinto y los cantos un poco más claros
// (color por vértice). Base plana y algo más ancha para que apoye. Altura 1 con la base en y = 0.
function rock(seed: number, [sx, sy, sz]: V3, cuts = 11, detail = 5) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const r = rng(seed), o = [r() * 9, r() * 9, r() * 9];
  const planes = Array.from({ length: cuts }, (_, i) => {
    const y = 1 - (1.25 * (i + 0.5)) / cuts, rad = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.39996 + r() * 0.6;
    return { n: new THREE.Vector3(Math.cos(th) * rad, y, Math.sin(th) * rad).normalize(), d: 0.62 + r() * 0.2 };
  });
  const pos = g.attributes.position, v = new THREE.Vector3(), col: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(1 + 0.07 * Math.sin(v.x * 2.3 + o[0]) * Math.sin(v.z * 1.9 + o[1]) + 0.04 * Math.sin(v.y * 3.1 + o[2]));
    let face = -1, e1 = -Infinity, e2 = -Infinity;
    planes.forEach(({ n, d }, k) => {
      const t = v.dot(n), ex = t - d;
      if (ex > e1) { e2 = e1; e1 = ex; face = k; } else if (ex > e2) e2 = ex;
      v.addScaledVector(n, smin(t, d, 0.08) - t);
    });
    const tone = 1 + sstep(-0.05, 0, e1) * (hash(face + seed * 7) - 0.5) * 0.24 + sstep(-0.035, 0, e2) * 0.09;
    col.push(tone * 1.02, tone, tone * 0.97);
    const y = -smin(-v.y, 0.48, 0.12), spread = 1 + 0.16 * (1 - sstep(-0.48, 0.25, y));
    pos.setXYZ(i, v.x * sx * spread, y * sy, v.z * sz * spread);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  normalize(g);
  g.computeVertexNormals();
  return g;
}
// Mediana asimétrica, pequeña achatada, grande con muchas caras, alargada; y un grupito de piedras.
const ROCK_ARGS: [number, V3, number][] = [[3, [1.15, 0.85, 1.0], 11], [8, [1.35, 0.5, 1.1], 9], [13, [1.0, 1.0, 0.88], 14], [21, [1.6, 0.68, 0.8], 11]];
const BASE_ROCKS = ROCK_ARGS.map(([s, k, c]) => rock(s, k, c));
const cluster = (() => {
  const parts = ([[0, 1, 0, 0, 0], [3, 0.58, 0.85, 0.3, 1.2], [1, 0.42, -0.62, 0.48, 2.5], [1, 0.3, 0.25, 0.9, 0.7]] as const).map(([k, s, x, z, ry]) =>
    BASE_ROCKS[k].clone().scale(s, s, s).rotateY(ry).translate(x, 0, z));
  return normalize(merge(parts));
})();
export const ROCKS = [...BASE_ROCKS, cluster];
// Mismas formas con menos polígonos (guijarros, piedras pequeñas): variantes 0-3.
export const ROCKS_LO = ROCK_ARGS.map(([s, k, c]) => rock(s, k, c, 2));
export const ROCK_HW = ROCKS.map(g => (g.boundingBox!.max.x + g.boundingBox!.max.z) / 2); // semiancho a altura 1

// Losa irregular con bisel (pasaderas, piedras del camino). Altura 1, radio ~1. Borde algo más oscuro.
function flagstone(seed: number, irregular = 0.3) {
  const r = rng(seed), n = 8;
  const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + r() * 0.3, k = 1.08 - irregular + r() * irregular; return new THREE.Vector2(Math.cos(a) * k, Math.sin(a) * k); });
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(new THREE.SplineCurve([...pts, pts[0]]).getPoints(28)), {
    depth: 0.5, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.2, bevelSegments: 3, curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.25, 0);
  return paint(smoothSlab(g, 1, 0), (x, y, z) => (1.04 - 0.16 * sstep(0.55, 1.05, Math.hypot(x, z))) * (0.75 + 0.25 * y));
}
export const FLAGS = [flagstone(4), flagstone(9), flagstone(17)];
// Adoquines del camino: casi redondos.
export const COBBLES = [flagstone(5, 0.1), flagstone(11, 0.1)];

// ---------- Copas y matas ----------

// Envolvente de una copa (elipsoide): centro y semiejes.
type Env = { c: V3; r: V3 };
export type Puff = { c: THREE.Vector3; r: THREE.Vector3; core?: boolean };
const TINTS: RGB[] = [[1.05, 1.03, 0.86], [1, 1, 1], [0.93, 0.99, 1.04], [1.02, 1.05, 0.92]];

// Copa: cada envolvente lleva un núcleo oscuro y, sobre su superficie, matas con lóbulos de tamaños distintos
// (silueta festoneada, huecos con profundidad). Las normales se mezclan con las de la envolvente para que la
// copa se sombree como un volumen; el color por vértice oscurece lo hundido (hacia dentro, pliegues, bajo otra
// mata) y aclara y calienta lo de arriba. Los triángulos tapados por otra mata se descartan.
export function canopy(seed: number, envs: Env[], { count = 22, size = [0.26, 0.6], lobes = 11, amp = 0.22, ground = -Infinity, detail = 0 } = {}) {
  const r = rng(seed), tmp = new THREE.Vector3();
  const E = envs.map(e => ({ c: new THREE.Vector3(...e.c), r: new THREE.Vector3(...e.r) }));
  const area = E.map(e => e.r.x * e.r.z + e.r.y * (e.r.x + e.r.z)), tot = area.reduce((a, b) => a + b, 0);
  const puffs: Puff[] = E.map(e => ({ c: e.c.clone(), r: e.r.clone().multiplyScalar(0.8), core: true }));
  E.forEach((e, k) => {
    const n = Math.round((count * area[k]) / tot), ph = r() * 6.28;
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n, rad = Math.sqrt(1 - y * y), th = i * 2.39996 + r() * 0.5;
      const d = new THREE.Vector3(Math.cos(th) * rad, y + (r() - 0.5) * 0.15, Math.sin(th) * rad).normalize();
      if (d.y < -0.6 && r() < 0.7) continue; // por debajo casi no hay matas: se ve el núcleo oscuro
      // muchas matas pequeñas y pocas grandes; algo aplastadas, para que se lean como racimos de hojas y no como bolas
      const bump = 1 + 0.14 * Math.sin(3 * th + ph) * Math.cos(2 * y + ph), s = (size[0] + (size[1] - size[0]) * r() ** 1.6) * (0.85 + 0.3 * Math.max(0, d.y));
      puffs.push({ c: e.c.clone().add(d.multiply(e.r).multiplyScalar(0.8 * bump)), r: new THREE.Vector3(s, s * 0.8, s) });
    }
  });
  const parts = puffs.map((p, i) => {
    const a = p.core ? 0.12 : amp, g = blob(seed * 31 + i, p.core ? 8 : lobes, a, detail || (p.core || p.r.x > 0.42 ? 4 : 3));
    const pos = g.attributes.position, nor = g.attributes.normal, col: number[] = [], hidden: boolean[] = [];
    const v = new THREE.Vector3(), n = new THREE.Vector3(), en = new THREE.Vector3(), tint = TINTS[Math.floor(r() * TINTS.length)];
    for (let j = 0; j < pos.count; j++) {
      v.fromBufferAttribute(pos, j);
      const crease = 0.6 + 0.4 * sstep(0.1, 0.9, (v.length() - (1 - a)) / a); // entre lóbulos, más oscuro
      if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.5; // panza algo plana
      v.multiply(p.r).add(p.c);
      v.y = Math.max(v.y, ground);
      let best = Infinity, be = E[0];
      for (const e of E) { const q = tmp.copy(v).sub(e.c).divide(e.r).length(); if (q < best) { best = q; be = e; } }
      en.copy(v).sub(be.c).divide(be.r).divide(be.r).normalize();
      n.fromBufferAttribute(nor, j).lerp(en, p.core ? 1 : 0.62).normalize();
      let occ = 1, hide = false;
      puffs.forEach((o, m) => {
        if (m === i) return;
        const q = tmp.copy(v).sub(o.c).divide(o.r), d = q.length();
        if (!o.core) occ = Math.min(occ, 0.55 + 0.45 * sstep(0.8, 1.3, d));
        if (d < 0.82 && q.y > -0.3) hide = true;
      });
      hidden.push(hide);
      const top = sstep(-0.4, 0.9, en.y), l = (0.36 + 0.64 * sstep(0.6, 1.02, best)) * (0.78 + 0.4 * top) * occ * crease;
      col.push(l * tint[0] * (1 + 0.14 * top), l * tint[1] * (1 + 0.07 * top), l * tint[2]); // arriba, verde amarillo pálido
      pos.setXYZ(j, v.x, v.y, v.z);
      nor.setXYZ(j, n.x, n.y, n.z);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const idx = g.index!.array, keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) if (!(hidden[idx[t]] && hidden[idx[t + 1]] && hidden[idx[t + 2]])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    g.setIndex(keep);
    return g;
  });
  return { geo: merge(parts), puffs };
}

// Tronco: pie con raíces que asoman sobre la hierba, fuste algo curvado, tres ramas que suben a la copa y una
// guía hasta la envolvente más alta.
function trunk(seed: number, envs: Env[], lean: number) {
  const r = rng(seed + 100);
  const prof = [[0.42, -0.05], [0.33, 0.06], [0.26, 0.2], [0.22, 0.42], [0.205, 0.62]].map(([x, y]) => new THREE.Vector2(x, y));
  const base = new THREE.LatheGeometry(prof, 14), bp = base.attributes.position, ph = seed * 1.7;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i), a = Math.atan2(z, x);
    const k = 1 + 0.3 * (1 - sstep(0, 0.4, y)) * Math.max(0, Math.cos(5 * a + ph)) ** 2;
    bp.setXYZ(i, x * k, y, z * k);
  }
  base.computeVertexNormals();
  const top: V3 = [lean, 1.6, 0], e0 = envs[0], hi = envs.reduce((a, b) => (b.c[1] > a.c[1] ? b : a));
  const parts = [base, tube([[0, 0.4, 0], [lean * 0.25 + 0.06, 1.0, 0.05], top], 0.215, 0.15, 8, 12)];
  parts.push(tube([top, [hi.c[0] * 0.6 + lean * 0.4, (top[1] + hi.c[1]) / 2, hi.c[2] * 0.6], [hi.c[0], hi.c[1] - hi.r[1] * 0.2, hi.c[2]]], 0.15, 0.06, 6));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r() * 0.8, k = 0.55 + r() * 0.15, s: V3 = [lean * 0.85, 1.3 + i * 0.12, 0];
    const end: V3 = [e0.c[0] + Math.cos(a) * e0.r[0] * k, e0.c[1] - e0.r[1] * 0.1 + r() * 0.15, e0.c[2] + Math.sin(a) * e0.r[2] * k];
    parts.push(tube([s, [s[0] + (end[0] - s[0]) * 0.6, s[1] + (end[1] - s[1]) * 0.3, s[2] + (end[2] - s[2]) * 0.6], end], 0.1, 0.035, 6, 6));
  }
  for (let i = 0; i < 4; i++) { // raíces sobre el suelo, el extremo se hunde en la hierba
    const a = (i / 4) * Math.PI * 2 + ph + r() * 0.5, L = 0.42 + r() * 0.2, c = Math.cos(a), s = Math.sin(a);
    parts.push(tube([[c * 0.12, 0.24, s * 0.12], [c * L * 0.55, 0.06, s * L * 0.55], [c * L, -0.08, s * L]], 0.11, 0.05, 5, 8));
  }
  return paint(merge(parts), (x, y) => 0.62 + 0.38 * sstep(-0.05, 0.8, y));
}

// Cuatro árboles: redondo, alto en dos pisos, ancho y ladeado, y uno de copas en terrazas (como el grande de la
// referencia). Copa y tronco van a juego.
export const TREE_KINDS = ([
  [5, 0, 24, [{ c: [0, 2.5, 0], r: [1.2, 0.95, 1.15] }]],
  [12, 0.05, 22, [{ c: [0, 2.5, 0], r: [0.88, 0.85, 0.88] }, { c: [0.05, 3.3, 0], r: [0.62, 0.6, 0.62] }]],
  [27, 0.2, 24, [{ c: [0.25, 2.45, 0], r: [1.25, 0.75, 1.05] }, { c: [-0.75, 2.05, 0.35], r: [0.6, 0.5, 0.6] }]],
  [33, 0.1, 26, [{ c: [0, 2.15, 0], r: [1.3, 0.5, 1.25] }, { c: [0.15, 2.7, -0.1], r: [1.0, 0.5, 0.95] }, { c: [0, 3.2, 0.05], r: [0.6, 0.42, 0.6] }]],
] as [number, number, number, Env[]][]).map(([seed, lean, count, envs]) => ({ canopy: canopy(seed, envs, { count }).geo, trunk: trunk(seed, envs, lean) }));

// Arbustos (base en y = 0): redondo, ancho de dos bultos y alto. Las matas se usan para colocar las flores.
export const BUSH_KINDS = ([
  [[{ c: [0, 0.3, 0], r: [0.6, 0.36, 0.56] }], 13],
  [[{ c: [-0.2, 0.28, 0], r: [0.45, 0.34, 0.45] }, { c: [0.32, 0.22, 0.1], r: [0.36, 0.28, 0.36] }], 14],
  [[{ c: [0, 0.36, 0], r: [0.5, 0.45, 0.5] }], 12],
] as [Env[], number][]).map(([envs, count], i) => canopy(40 + i, envs, { count, size: [0.18, 0.32], lobes: 9, amp: 0.2, ground: 0, detail: 2 }));

// Hiedra: un tallo que cuelga del alero y hojas planas (mirando a +z, hacia fuera del muro) que se estrechan hacia
// abajo. Origen arriba; mide ~0.5 de ancho y 0.75 de largo.
export const IVY = (() => {
  const r = rng(61), parts: THREE.BufferGeometry[] = [tinted(tube([[0, 0, 0.01], [0.05, -0.3, 0.02], [-0.04, -0.55, 0.02], [0.02, -0.75, 0.015]], 0.012, 0.006, 6, 4), '#5d7a3a')];
  for (let k = 0; k < 24; k++) {
    const y = -Math.sqrt(r()) * 0.72, x = (r() - 0.5) * 0.5 * (1 + y * 0.9), l = 0.8 + r() * 0.35;
    const leaf = new THREE.SphereGeometry(1, 7, 4);
    leaf.scale(0.07, 0.06, 0.016); leaf.rotateZ(r() * 6.28); leaf.rotateX(-0.25 + r() * 0.2); leaf.translate(x, y, 0.025 + r() * 0.03);
    parts.push(paint(leaf, () => l));
  }
  return merge(parts);
})();

// ---------- Hierba, flores y plantas ----------

// Hoja/brizna: tira estrecha que se curva hacia fuera y acaba en punta. Las normales miran casi arriba
// (la hierba se ilumina como el césped) y se escriben las dos caras para no usar DoubleSide.
type Blade = { a: number; out: number; h: number; w: number; r0?: number; c0: RGB; c1: RGB };
function blades(list: Blade[]) {
  const P: number[] = [], N: number[] = [], C: number[] = [];
  for (const { a, out, h, w, r0 = 0.02, c0, c1 } of list) {
    const dx = Math.cos(a), dz = Math.sin(a), n = new THREE.Vector3(dx * 0.4, 1, dz * 0.4).normalize();
    const lv = [0, 0.4, 0.75, 1].map(t => {
      const cx = dx * (r0 + out * h * t * t), cz = dz * (r0 + out * h * t * t), ww = w * (1 - t) ** 0.8 * (t < 0.2 ? 0.8 + t : 1);
      return { L: [cx - dz * ww, h * t, cz + dx * ww], R: [cx + dz * ww, h * t, cz - dx * ww], c: c0.map((v, k) => v + (c1[k] - v) * t) };
    });
    const tri = (...vs: { p: number[]; c: number[] }[]) => {
      for (const order of [[0, 1, 2], [0, 2, 1]]) for (const k of order) { P.push(...vs[k].p); N.push(n.x, n.y, n.z); C.push(...vs[k].c); }
    };
    for (let j = 0; j < 3; j++) {
      const A = lv[j], B = lv[j + 1];
      tri({ p: A.L, c: A.c }, { p: A.R, c: A.c }, { p: B.R, c: B.c });
      tri({ p: A.L, c: A.c }, { p: B.R, c: B.c }, { p: B.L, c: B.c });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}

// Plantas bajas: abanicos de briznas (tres alturas), una de hoja ancha y una de tres briznas altas.
export const TUFTS = ([[5, 0.3, 0.03, 0.35], [7, 0.36, 0.03, 0.35], [4, 0.46, 0.03, 0.35], [5, 0.2, 0.075, 0.65], [3, 0.55, 0.022, 0.15]] as const).map(([n, h, w, out], s) => {
  const r = rng(70 + s);
  return blades(Array.from({ length: n }, (_, i) => {
    const l = 0.9 + r() * 0.2;
    return { a: (i / n) * Math.PI * 2 + r() * 0.9, out: out * (0.7 + r() * 0.6), h: h * (0.55 + r() * 0.55), w: w * (1 + r() * 0.4), c0: [0.5, 0.55, 0.45] as RGB, c1: [1.05 * l, 1.1 * l, 0.85 * l] as RGB };
  }));
});

// Corro de tréboles: hojitas de tres folíolos a distintas alturas, a ras de suelo. Radio ~0.3.
export const CLOVER = (() => {
  const r = rng(91), parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * 0.24, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.03 + r() * 0.05, ry = r() * 6.28, l = 0.85 + r() * 0.25;
    for (let j = 0; j < 3; j++) {
      const p = new THREE.SphereGeometry(1, 6, 3);
      p.scale(0.05, 0.012, 0.044); p.translate(0.045, 0, 0); p.rotateZ(0.3); p.rotateY(ry + (j * Math.PI * 2) / 3); p.translate(x, h, z);
      parts.push(paint(p, (px, _, pz) => l * (0.85 + 0.3 * sstep(0, 0.07, Math.hypot(px - x, pz - z)))));
    }
    const s = new THREE.CylinderGeometry(0.004, 0.006, h, 3, 1, true); s.translate(x, h / 2, z);
    parts.push(tinted(s, '#4f8a33'));
  }
  return merge(parts);
})();

// Brotes del huerto: hojas anchas y cortas en roseta.
export const SPROUT = blades(Array.from({ length: 5 }, (_, i) => ({ a: (i / 5) * Math.PI * 2 + i * 0.3, out: 0.55, h: 0.22 + (i % 2) * 0.08, w: 0.06, c0: [0.55, 0.65, 0.5] as RGB, c1: [1.05, 1.1, 0.9] as RGB })));

// Pétalos (elipsoides finos) en corona, con la punta levantada `cup` rad. Radio ~1. Base algo más oscura.
function petals(n: number, len: number, wid: number, cup: number, y = 0, twist = 0) {
  const g = merge(Array.from({ length: n }, (_, i) => {
    const p = new THREE.SphereGeometry(1, 6, 4);
    p.scale(len / 2, 0.14, wid / 2);
    p.translate(len * 0.45, 0, 0);
    p.rotateZ(cup);
    p.rotateY((i / n) * Math.PI * 2 + twist);
    p.translate(0, y, 0);
    return p;
  }));
  return paint(g, (x, _, z) => 0.72 + 0.3 * sstep(0, 0.7 * len, Math.hypot(x, z)));
}
// Flores del césped (radio 1, tallo de 1.4 hasta el suelo): de cinco pétalos redondos y margarita de nueve
// estrechos. Los pétalos toman el color de la instancia; el botón y el tallo van aparte con su propio color.
export const FLOWERS = [petals(5, 1, 0.72, 0.28), petals(9, 1.05, 0.34, 0.16)];
const core = (r: number, h: string) => { const g = new THREE.SphereGeometry(r, 8, 4); g.scale(1, 0.6, 1); g.translate(0, 0.08, 0); return tinted(g, h); };
const stem = (h: number) => { const g = new THREE.CylinderGeometry(0.16, 0.2, h, 5, 1, true); g.translate(0, -h / 2, 0); return tinted(g, '#5d9a3a'); };
export const FLOWER_CORE = merge([core(0.32, '#ffc93d'), stem(1.4)]);
export const BLOSSOM_CORE = core(0.34, '#ffd34d'); // flores de los arbustos (sin tallo)
// Loto: dos coronas, la de dentro más cerrada.
export const LOTUS = merge([petals(8, 1, 0.42, 0.42), petals(6, 0.75, 0.42, 0.95, 0.05, 0.3)]);

// Nenúfar: disco con la muesca típica, grueso apenas y algo más claro hacia el borde.
export const LILY_PAD = (() => {
  const pts = Array.from({ length: 26 }, (_, i) => { const a = 0.4 + (i / 25) * (Math.PI * 2 - 0.55); return new THREE.Vector2(Math.cos(a), Math.sin(a)); });
  pts.push(new THREE.Vector2(0.12, 0.02));
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return paint(prep(g), (x, _, z) => 0.82 + 0.22 * Math.hypot(x, z));
})();

// Enea: tallo, espiga marrón y unas hojas largas. Base en y = 0.
export const CATTAIL = (() => {
  const s = new THREE.CylinderGeometry(0.012, 0.02, 1.0, 5, 1, true); s.translate(0, 0.5, 0);
  const head = new THREE.CapsuleGeometry(0.045, 0.2, 3, 8); head.translate(0, 0.8, 0);
  const tip = new THREE.CylinderGeometry(0.004, 0.008, 0.12, 4); tip.translate(0, 1.0, 0);
  const leaves = blades([0.4, 2.5, 4.4].map((a, i) => ({ a, out: 0.35, h: 0.6 + i * 0.12, w: 0.035, c0: hex('#4f8a33'), c1: hex('#9ccf63') })));
  return merge([tinted(s, '#6aa843'), tinted(head, '#7a4a2b'), tinted(tip, '#6aa843'), leaves]);
})();

// ---------- Madera, piedra y objetos ----------

// Poste con remate en punta de diamante. Base en y = 0.
export function post(w: number, h: number) {
  const b = new RoundedBoxGeometry(w, h, w, 2, w * 0.18); b.translate(0, h / 2, 0);
  const cap = new THREE.ConeGeometry(w * 0.74, w * 0.65, 4); cap.rotateY(Math.PI / 4); cap.translate(0, h + w * 0.32, 0);
  return merge([b, cap]);
}

// Teja de escama: borde de abajo redondo (+z local = hacia el alero). Caja unidad, se escala por instancia.
export const SHINGLE = (() => {
  const s = new THREE.Shape();
  s.moveTo(0.5, 0.5); s.lineTo(-0.5, 0.5); s.lineTo(-0.5, 0); s.absellipse(0, 0, 0.5, 0.5, Math.PI, Math.PI * 2, false); s.lineTo(0.5, 0.5);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.06, bevelSegments: 1, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -0.4, 0);
  g.deleteAttribute('uv');
  return g;
})();

// Cojín: esfera cuadrada en planta y aplastada, más fina en los bordes (relleno abombado). 2 x 1 x 2.
export const CUSHION = (() => {
  const g = new THREE.SphereGeometry(1, 20, 12), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), sx = Math.sign(x) * Math.abs(x) ** 0.55, sz = Math.sign(z) * Math.abs(z) ** 0.55;
    p.setXYZ(i, sx, y * 0.5 * (1 - 0.6 * Math.max(Math.abs(sx), Math.abs(sz)) ** 4), sz);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
})();

// Cuenco de revolución con labio en el borde. Radio 0.3, alto 0.17; el fondo de dentro está a 0.11.
export const BOWL = new THREE.LatheGeometry([[0, 0], [0.2, 0], [0.26, 0.015], [0.29, 0.08], [0.305, 0.15], [0.29, 0.172], [0.265, 0.15], [0.25, 0.11], [0, 0.11]].map(([x, y]) => new THREE.Vector2(x, y)), 28);

// Tronco cortado: corteza oscura y tapas claras.
export const LOG = (() => {
  const bark = new THREE.CylinderGeometry(1, 1, 1, 9, 1, true);
  const caps = [-0.5, 0.5].map(y => { const g = new THREE.CircleGeometry(0.97, 9); g.rotateX(y > 0 ? -Math.PI / 2 : Math.PI / 2); g.translate(0, y, 0); return g; });
  return merge([tinted(bark, '#7a4f33'), ...caps.map(c => tinted(c, '#e2b27a'))]);
})();

// Llama: gota de revolución, ancha abajo y en punta, amarilla en la base y naranja arriba. Altura 1.
export const FLAME = (() => {
  const lo = new THREE.Color('#ffe45c'), hi = new THREE.Color('#ff7a22'), k = new THREE.Color();
  return paint(prep(new THREE.LatheGeometry(Array.from({ length: 10 }, (_, i) => {
    const t = i / 9;
    return new THREE.Vector2(0.5 * Math.sin(Math.PI * Math.min(1, t ** 0.6 * 1.05)) * (1 - t) ** 0.5, t);
  }), 10)), (_, y) => k.copy(lo).lerp(hi, sstep(0.1, 0.75, y)).toArray() as RGB);
})();
