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

// ---------- Rocas ----------

// Esfera recortada por planos con un mínimo suave: caras planas con cantos gastados, nada de bola.
// Base plana y algo más ancha para que apoye. Normalizada a altura 1 con la base en y = 0.
function rock(seed: number, [sx, sy, sz]: V3, cuts = 7, detail = 5) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const r = rng(seed), o = [r() * 9, r() * 9, r() * 9];
  const planes = Array.from({ length: cuts }, (_, i) => {
    const a = (i / cuts) * Math.PI * 2 + r() * 0.9, el = -0.15 + r() * 1.25;
    return { n: new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)), d: 0.68 + r() * 0.2 };
  });
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(1 + 0.1 * Math.sin(v.x * 2.1 + o[0]) * Math.sin(v.z * 1.7 + o[1]) + 0.05 * Math.sin(v.y * 2.9 + o[2]));
    for (const { n, d } of planes) { const t = v.dot(n); v.addScaledVector(n, smin(t, d, 0.16) - t); }
    const y = -smin(-v.y, 0.5, 0.14), spread = 1 + 0.16 * (1 - sstep(-0.5, 0.25, y));
    pos.setXYZ(i, v.x * sx * spread, y * sy, v.z * sz * spread);
  }
  g.computeBoundingBox();
  const b = g.boundingBox!, h = b.max.y - b.min.y;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(1 / h, 1 / h, 1 / h);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}
// Redonda, achatada, alta y alargada. ROCKS_LO: mismas formas con menos polígonos (guijarros, piedras pequeñas).
const ROCK_ARGS: [number, V3, number][] = [[3, [1.1, 0.8, 1.0], 7], [8, [1.3, 0.5, 1.05], 8], [13, [0.82, 1.0, 0.74], 6], [21, [1.5, 0.7, 0.78], 7]];
export const ROCKS = ROCK_ARGS.map(([s, k, c]) => rock(s, k, c));
export const ROCKS_LO = ROCK_ARGS.map(([s, k, c]) => rock(s, k, c, 2));
export const ROCK_HW = ROCKS.map(g => (g.boundingBox!.max.x + g.boundingBox!.max.z) / 2); // semiancho a altura 1

// Losa irregular con bisel (pasaderas, guijarros del camino). Altura 1, radio ~1.
function flagstone(seed: number) {
  const r = rng(seed), n = 8;
  const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + r() * 0.3, k = 0.78 + r() * 0.3; return new THREE.Vector2(Math.cos(a) * k, Math.sin(a) * k); });
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(new THREE.SplineCurve([...pts, pts[0]]).getPoints(28)), {
    depth: 0.5, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.2, bevelSegments: 3, curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.25, 0);
  return smoothSlab(g, 1, 0);
}
export const FLAGS = [flagstone(4), flagstone(9), flagstone(17)];

// ---------- Copas y matas ----------

export type Clump = { c: V3; r: number };

// Varias matas con lóbulos fusionadas en una malla. Normales medio esféricas (la mata se lee como un volumen
// blando), más oscuro en los pliegues entre matas y por debajo, más claro y cálido arriba. Los triángulos
// tapados por otra mata se descartan.
export function foliage(seed: number, clumps: Clump[], { detail = 7, lobes = 26, amp = 0.18, ground = -Infinity } = {}) {
  const r = rng(seed);
  const lo = Math.min(...clumps.map(k => k.c[1] - k.r)), hi = Math.max(...clumps.map(k => k.c[1] + k.r));
  const centers = clumps.map(k => new THREE.Vector3(...k.c));
  const parts = clumps.map((k, i) => {
    const g = blob(seed * 31 + i, lobes, amp, detail);
    const pos = g.attributes.position, nor = g.attributes.normal, col: number[] = [];
    const v = new THREE.Vector3(), n = new THREE.Vector3(), w = new THREE.Vector3(), tint = 0.93 + r() * 0.14;
    const hidden: boolean[] = [];
    for (let j = 0; j < pos.count; j++) {
      v.fromBufferAttribute(pos, j);
      const crease = 0.62 + 0.38 * sstep(0.1, 0.9, (v.length() - (1 - amp)) / amp); // entre lóbulos, más oscuro: se leen las hojas
      if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.5; // panza algo plana
      n.fromBufferAttribute(nor, j).lerp(w.copy(v).normalize(), 0.3).normalize();
      v.multiplyScalar(k.r).add(centers[i]);
      v.y = Math.max(v.y, ground);
      let occ = 1, inside = false;
      centers.forEach((c, m) => {
        if (m === i) return;
        const d = v.distanceTo(c) / clumps[m].r;
        occ = Math.min(occ, 0.5 + 0.5 * sstep(0.75, 1.3, d));
        if (d < 0.8 && v.y - c.y > -0.25 * clumps[m].r) inside = true;
      });
      hidden.push(inside);
      const top = sstep(-0.7, 0.9, (v.y - k.c[1]) / k.r), l = (0.62 + 0.48 * top) * (0.78 + 0.22 * sstep(lo, hi, v.y)) * occ * crease * tint;
      col.push(l * (1 + 0.07 * top), l, l * (1 - 0.12 * top));
      pos.setXYZ(j, v.x, v.y, v.z);
      nor.setXYZ(j, n.x, n.y, n.z);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const idx = g.index!.array, keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) if (!(hidden[idx[t]] && hidden[idx[t + 1]] && hidden[idx[t + 2]])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    g.setIndex(keep);
    return g;
  });
  return merge(parts);
}

// Copa: mata central grande, un anillo de matas a distintas alturas y una o dos arriba. lean = copa ladeada.
function treeClumps(seed: number, { ring = 5, spread = 0.9, lean = 0, tall = 0 }) {
  const r = rng(seed), out: Clump[] = [{ c: [lean * 0.8, 2.35 + tall * 0.35, 0], r: 0.95 }];
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + r() * 0.7, d = spread * (0.78 + r() * 0.32), y = 1.95 + r() * 0.5 + tall * 0.25;
    out.push({ c: [Math.cos(a) * d + lean * (y - 1.4), y, Math.sin(a) * d], r: 0.55 + r() * 0.25 });
  }
  for (let i = 0; i <= tall; i++) {
    const a = r() * Math.PI * 2;
    out.push({ c: [Math.cos(a) * 0.35 + lean * 1.6, 2.95 + tall * 0.4 + i * 0.5, Math.sin(a) * 0.35], r: 0.66 - i * 0.12 + r() * 0.1 });
  }
  return out;
}

// Rama/tronco cónico de a a b.
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 7) {
  const d = b.clone().sub(a), len = d.length(), g = new THREE.CylinderGeometry(r1, r0, len, seg, 3, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

// Tronco con raíces que se abren en el pie, algo inclinado, y ramas que se meten en las matas.
function trunk(seed: number, clumps: Clump[], lean: number) {
  const prof = [[0.42, -0.05], [0.33, 0.06], [0.26, 0.2], [0.225, 0.45], [0.2, 0.85], [0.175, 1.5], [0.15, 2.15]].map(([x, y]) => new THREE.Vector2(x, y));
  const base = new THREE.LatheGeometry(prof, 14);
  const pos = base.attributes.position, ph = seed * 1.7;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x);
    const k = 1 + 0.45 * (1 - sstep(0, 0.4, y)) * Math.max(0, Math.cos(5 * a + ph)) ** 2 + 0.04 * Math.sin(y * 5 + a * 3);
    pos.setXYZ(i, x * k + lean * (y / 2.15) ** 2 * 0.8, y, z * k);
  }
  base.computeVertexNormals();
  const top = new THREE.Vector3(lean * 0.6, 1.55, 0);
  const branches = clumps.slice(1, 4).map(k => limb(top, new THREE.Vector3(...k.c).lerp(new THREE.Vector3(...clumps[0].c), 0.25), 0.1, 0.05));
  const g = merge([base, ...branches]);
  const p = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) { const l = 0.68 + 0.32 * sstep(0, 0.7, p.getY(i)); c.setXYZ(i, l, l, l); }
  return g;
}

// Tres árboles distintos (redondo, alto y ladeado): copa y tronco van a juego.
export const TREE_KINDS = [
  { seed: 5, ring: 5, spread: 0.92, lean: 0, tall: 0 },
  { seed: 12, ring: 4, spread: 0.72, lean: 0.05, tall: 1 },
  { seed: 27, ring: 5, spread: 0.85, lean: 0.22, tall: 0 },
].map(({ seed, ...o }) => {
  const clumps = treeClumps(seed, o);
  return { canopy: foliage(seed, clumps), trunk: trunk(seed, clumps, o.lean) };
});

// Arbustos: matas bajas sobre el suelo (y = 0), para escalar por instancia.
export const BUSH_KINDS = [4, 5, 6].map((n, i) => {
  const r = rng(40 + i), clumps: Clump[] = [{ c: [0, 0.36, 0], r: 0.5 }];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.6, d = 0.36 + r() * 0.12;
    clumps.push({ c: [Math.cos(a) * d, 0.22 + r() * 0.12, Math.sin(a) * d], r: 0.32 + r() * 0.1 });
  }
  return { clumps, geo: foliage(40 + i, clumps, { detail: 4, lobes: 16, amp: 0.18, ground: 0 }) };
});

// Mata pequeña para la hiedra de la casa.
export const IVY = foliage(61, [{ c: [0, 0, 0], r: 0.8 }, { c: [0.6, -0.25, 0.1], r: 0.55 }, { c: [-0.5, -0.35, 0.05], r: 0.5 }], { detail: 3, lobes: 14, amp: 0.18 });

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

// Manojos de hierba: abanicos de briznas de alturas distintas, oscuros en la base y claros en la punta.
export const TUFTS = [[5, 0.3], [7, 0.36], [4, 0.46]].map(([n, h], s) => {
  const r = rng(70 + s);
  return blades(Array.from({ length: n }, (_, i) => {
    const l = 0.9 + r() * 0.2;
    return { a: (i / n) * Math.PI * 2 + r() * 0.9, out: 0.25 + r() * 0.45, h: h * (0.55 + r() * 0.55), w: 0.03 + r() * 0.012, c0: [0.5, 0.55, 0.45] as RGB, c1: [1.05 * l, 1.1 * l, 0.85 * l] as RGB };
  }));
});

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
  const pos = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < pos.count; i++) { const l = 0.72 + 0.3 * sstep(0, 0.7 * len, Math.hypot(pos.getX(i), pos.getZ(i))); c.setXYZ(i, l, l, l); }
  return g;
}
// Flor del césped (radio 1, tallo de 1.4 hasta el suelo). Los pétalos toman el color de la instancia;
// el botón y el tallo van aparte con su propio color.
export const FLOWER = petals(5, 1, 0.72, 0.28);
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
  const out = prep(g), pos = out.attributes.position, c = out.attributes.color;
  for (let i = 0; i < pos.count; i++) { const l = 0.82 + 0.22 * Math.hypot(pos.getX(i), pos.getZ(i)); c.setXYZ(i, l, l, l); }
  return out;
})();

// Enea: tallo, espiga marrón y unas hojas largas. Base en y = 0.
export const CATTAIL = (() => {
  const s = new THREE.CylinderGeometry(0.012, 0.02, 1.0, 5, 1, true); s.translate(0, 0.5, 0);
  const head = new THREE.CapsuleGeometry(0.045, 0.2, 3, 8); head.translate(0, 0.8, 0);
  const tip = new THREE.CylinderGeometry(0.004, 0.008, 0.12, 4); tip.translate(0, 1.0, 0);
  const leaves = blades([0.4, 2.5, 4.4].map((a, i) => ({ a, out: 0.35, h: 0.6 + i * 0.12, w: 0.035, c0: hex('#4f8a33'), c1: hex('#9ccf63') })));
  return merge([tinted(s, '#6aa843'), tinted(head, '#7a4a2b'), tinted(tip, '#6aa843'), leaves]);
})();

// ---------- Madera y piedra ----------

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

// Tronco cortado: corteza oscura y tapas claras con anillos.
export const LOG = (() => {
  const bark = new THREE.CylinderGeometry(1, 1, 1, 9, 1, true);
  const caps = [-0.5, 0.5].map(y => { const g = new THREE.CircleGeometry(0.97, 9); g.rotateX(y > 0 ? -Math.PI / 2 : Math.PI / 2); g.translate(0, y, 0); return g; });
  const g = merge([tinted(bark, '#7a4f33'), ...caps.map(c => tinted(c, '#e2b27a'))]);
  const pos = g.attributes.position, col = g.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const rr = Math.hypot(pos.getX(i), pos.getZ(i));
    if (Math.abs(pos.getY(i)) > 0.49 && rr < 0.96) { const k = rr < 0.05 ? 0.8 : 1; col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k); }
  }
  return g;
})();

// Llama: gota de revolución, ancha abajo y en punta, amarilla en la base y naranja arriba. Altura 1.
export const FLAME = (() => {
  const g = prep(new THREE.LatheGeometry(Array.from({ length: 10 }, (_, i) => {
    const t = i / 9;
    return new THREE.Vector2(0.5 * Math.sin(Math.PI * Math.min(1, t ** 0.6 * 1.05)) * (1 - t) ** 0.5, t);
  }), 10));
  const pos = g.attributes.position, c = g.attributes.color, lo = new THREE.Color('#ffe45c'), hi = new THREE.Color('#ff7a22'), k = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { k.copy(lo).lerp(hi, sstep(0.1, 0.75, pos.getY(i))); c.setXYZ(i, k.r, k.g, k.b); }
  return g;
})();
