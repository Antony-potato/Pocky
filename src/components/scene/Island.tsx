'use client';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { rng, uTime, shaded, VARY, blob, smoothSlab } from './materials';

// Isla generada por código (sin modelos externos). Mundo: x derecha, z hacia la cámara (sur), y arriba.
// La hierba está en y = 0. Las posiciones de los sitios coinciden con los nodos de nav.ts.

export const RX = 9.6;
export const RZ = 7.4;
const edgeR = (a: number) => 1 + 0.05 * Math.sin(3 * a + 1) + 0.03 * Math.sin(5 * a + 2);
const edgeAt = (a: number, k = 1): [number, number] => [Math.cos(a) * RX * edgeR(a) * k, Math.sin(a) * RZ * edgeR(a) * k];

const C = {
  grass: '#9ccb5e', dirt: '#c48e5c', path: '#e2bd86', stone: '#d4cbbd', rock: '#bdb5aa',
  trunk: '#8a5a3b', wood: '#a86f42', woodDark: '#8b5a33', leaf: ['#7cbf4e', '#8ed05c', '#6db347'],
  bush: '#6aad45', rim: '#d9c99c',
};

const SPHERE = new THREE.SphereGeometry(1, 16, 12);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const TRUNK = new THREE.CylinderGeometry(0.75, 1, 1, 14);
const BOX = new RoundedBoxGeometry(1, 1, 1, 2, 0.14); // cantos redondeados; con escala no uniforme el bisel se adapta a cada pieza
const CONE = new THREE.ConeGeometry(1, 1, 7);
const LEAF = blob(3, 26, 0.17, 6); // copas y arbustos: bola con muchos lóbulos pequeños
const ROCK = blob(5, 6, 0.14, 3);

const MAT = {
  vary: shaded({ roughness: 0.9 }, { key: 'vary', color: VARY }),
  // Copas con volumen: más oscuras por debajo (oclusión) y con manchas suaves de tono.
  leaf: shaded({ roughness: 0.85 }, {
    key: 'leaf',
    color: 'diffuseColor.rgb *= mix(.58, 1.1, smoothstep(-.95, .85, vL.y)) * (.92 + .16 * vnoise(vW.xz * .8 + vW.y * 1.3));',
  }),
  rock: shaded({ roughness: 0.92 }, {
    key: 'rock',
    color: 'diffuseColor.rgb *= mix(.74, 1.05, smoothstep(-.9, .9, vL.y)) * (.9 + .18 * vnoise(vL.xz * 2.5 + vL.y * 3.));',
  }),
};

type V3 = [number, number, number];
type Item = { p: V3; s?: number | V3; r?: number; c?: string };

// Caja con cantos redondeados y normales limpias (el RoundedBox de drei suaviza las normales hasta dentro
// de las caras grandes y deja un marco oscuro en las paredes).
function RBox({ args: [w, h, d], radius, ...props }: Omit<ThreeElements['mesh'], 'args'> & { args: V3; radius: number }) {
  const geo = useMemo(() => new RoundedBoxGeometry(w, h, d, 3, radius), [w, h, d, radius]);
  return <mesh geometry={geo} {...props} />;
}

// Un InstancedMesh por tipo de pieza: pocas draw calls para que vaya fluido en móvil.
function Scatter({ items, geo, color = '#ffffff', shadow = true, glow = false, mat = MAT.vary }: {
  items: Item[]; geo: THREE.BufferGeometry; color?: string; shadow?: boolean; glow?: boolean; mat?: THREE.Material;
}) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    items.forEach((it, i) => {
      const s = Array.isArray(it.s) ? it.s : [it.s ?? 1, it.s ?? 1, it.s ?? 1];
      m.compose(new THREE.Vector3(...it.p), q.setFromEuler(e.set(0, it.r ?? 0, 0)), new THREE.Vector3(...s));
      ref.current.setMatrixAt(i, m);
      ref.current.setColorAt(i, col.set(it.c ?? color));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [items, color]);
  return (
    <instancedMesh ref={ref} args={[geo, glow ? undefined : mat, items.length]} castShadow={shadow} receiveShadow>
      {glow && <meshBasicMaterial toneMapped={false} />}
    </instancedMesh>
  );
}

// ---------- Layout ----------

const PATHS: { pts: [number, number][]; w: number }[] = [
  { pts: [[-3.2, 7.2], [-2.4, 4.6], [-0.8, 2.0], [0, -0.5], [0.4, -3.5], [0.6, -7.3]], w: 0.8 },
  { pts: [[0.1, -1.3], [2.5, -1.3], [4.4, -0.9], [5.3, -1.4]], w: 0.62 },
];
const PATH_PTS = PATHS.flatMap(({ pts, w }) => {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  return curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.22)).map(v => ({ x: v.x, z: v.z, w }));
});

const PONDS = [
  { x: 3.8, z: 3.4, rx: 2.3, rz: 1.4 },
  { x: 6.5, z: 3.0, rx: 1.4, rz: 1.0 },
];
// El estanque es un hueco en la hierba (unión de las dos elipses, algo más grande: el bisel de la orilla
// baja hacia dentro) con el agua un poco por debajo del césped.
const POND_GROW = 0.18, POND_Y = -0.1;
const POND_O = [5.6, 3.2]; // punto dentro de las dos elipses: desde él la unión se recorre por ángulos
function pondOutline(grow: number, n = 72) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    const t = Math.max(...PONDS.map(p => { // salida del rayo por cada elipse; la unión es la más lejana
      const rx = p.rx + grow, rz = p.rz + grow, ox = (POND_O[0] - p.x) / rx, oz = (POND_O[1] - p.z) / rz;
      const ux = dx / rx, uz = dz / rz, A = ux * ux + uz * uz, B = 2 * (ox * ux + oz * uz), K = ox * ox + oz * oz - 1;
      return (-B + Math.sqrt(B * B - 4 * A * K)) / (2 * A);
    }));
    return new THREE.Vector2(POND_O[0] + dx * t, -(POND_O[1] + dz * t)); // y de la shape = -z del mundo
  });
}
const TREES: V3[] = [[-8.5, -2.4, 1.0], [-4.6, -6.0, 1.15], [-1.8, -6.4, 0.95], [4.2, -5.2, 1.5], [7.6, -4.0, 1.0], [-9.0, -0.6, 0.8], [8.9, -1.8, 0.85], [2.9, -6.4, 0.85]];
const CANOPY: [number, number, number, number][] = [[0, 2.3, 0, 1.0], [0.8, 2.0, 0.25, 0.75], [-0.75, 2.05, 0.1, 0.78], [0.15, 1.95, 0.8, 0.72], [-0.1, 2.1, -0.75, 0.76], [0.4, 2.85, -0.1, 0.7], [-0.35, 2.75, 0.3, 0.66]];
const BUSHES: [number, number, number, boolean][] = [[-3.5, -2.1, 0.8, true], [-7.3, -1.2, 0.7, false], [-8.4, 3.3, 0.8, false], [-6.0, 5.0, 0.7, true], [1.7, -4.8, 0.7, true], [-1.0, -4.8, 0.6, false], [8.4, 2.4, 0.7, false], [5.9, 5.5, 0.6, true], [-2.6, -5.2, 0.7, false], [6.4, -3.8, 0.7, true]];
const HOUSE = { x: -5.5, z: -3.0 };
const FIRE = { x: 5.9, z: -2.3 };
const BED = { x: 7.5, z: -0.4 };

const inEllipse = (x: number, z: number, cx: number, cz: number, rx: number, rz: number) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 < 1;
const inRect = (x: number, z: number, [x0, z0, x1, z1]: number[]) => x > x0 && x < x1 && z > z0 && z < z1;
const BLOCKED_RECTS = [[-7.4, -4.7, -3.6, -1.3], [-8.9, 0.4, -5.9, 2.8], [2.2, -4.3, 4.6, -2.3]];
const BLOCKED_SPOTS: V3[] = [[FIRE.x, FIRE.z, 1.0], [BED.x, BED.z, 0.8], [8.6, 1.2, 0.9], [8.0, -2.6, 0.9]];

// Rocas de la orilla, medio metidas en el agua (y = -1.5): las pequeñas bajan para tocarla.
const SHORE_ROCKS: Item[] = ([[200, 1.1], [150, 0.9], [25, 1.2], [340, 0.85], [75, 0.9], [112, 0.7], [255, 0.8]] as const).map(([deg, s]) => {
  const [x, z] = edgeAt((deg * Math.PI) / 180, 1.04);
  return { p: [x, Math.min(-0.75, -1.62 + 0.85 * s), z], s: [1.0 * s, 0.85 * s, 0.9 * s], r: deg };
});

// ---------- Shaders del suelo y del agua (GLSL inyectado en MeshStandardMaterial, ver materials.ts) ----------

const f = (n: number) => n.toFixed(3);
const lin = (hex: string) => new THREE.Color(hex).toArray().map(f).join(', '); // color lineal para GLSL
const pondField = (grow: number) => `min(${PONDS.map(p => `length((p - vec2(${f(p.x)}, ${f(p.z)})) / vec2(${f(p.rx + grow)}, ${f(p.rz + grow)}))`).join(', ')})`;

// Sitios que oscurecen un poco la hierba a su alrededor (oclusión de contacto): x, z, radio.
const OCCLUDERS: V3[] = [
  ...TREES.map(([x, z, s]): V3 => [x, z, 1.3 * s]),
  ...BUSHES.map(([x, z, s]): V3 => [x, z, 1.0 * s]),
  [-7.2, 4.4, 0.7], [1.2, 5.7, 0.6], [FIRE.x, FIRE.z, 0.8], [8.0, -2.6, 1.0],
];

const GRASS = shaded({ color: C.grass, roughness: 0.95 }, {
  key: 'grass',
  head: `const vec3 OCC[${OCCLUDERS.length}] = vec3[](${OCCLUDERS.map(o => `vec3(${o.map(f).join(', ')})`).join(', ')});`,
  color: /* glsl */ `
    vec2 p = vW.xz;
    // manchas de hierba más clara y más oscura a dos escalas
    float n = vnoise(p * .28) * .6 + vnoise(p * 1.1) * .4;
    diffuseColor.rgb *= mix(vec3(.84, .93, .9), vec3(1.08, 1.05, .88), n);
    // labio del borde de la isla: más oscuro según baja
    diffuseColor.rgb *= mix(.7, 1., smoothstep(-.75, -.04, vW.y));
    // orilla del estanque: arena, más oscura (mojada) al bajar hacia el agua
    vec3 sand = vec3(${lin(C.rim)}) * mix(.68, 1., smoothstep(${f(POND_Y - 0.02)}, -.01, vW.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, sand, 1. - smoothstep(1.0, 1.1 + .05 * vnoise(p * 5.), ${pondField(POND_GROW)}));
    // oclusión de contacto bajo árboles, arbustos, rocas y casa
    float ao = 1.;
    for (int i = 0; i < ${OCCLUDERS.length}; i++) {
      vec2 o = (p - OCC[i].xy) / OCC[i].z;
      ao *= 1. - .3 * (1. - smoothstep(.02, 1., dot(o, o)));
    }
    vec2 q = abs(p - vec2(${f(HOUSE.x)}, ${f(HOUSE.z)})) - vec2(1.58, 1.38);
    ao *= 1. - .4 * (1. - smoothstep(0., .9, length(max(q, 0.)) + min(max(q.x, q.y), 0.)));
    diffuseColor.rgb *= mix(1., ao, step(-.08, vW.y));`,
});

const DIRT = shaded({ color: C.dirt, roughness: 1 }, {
  key: 'dirt',
  color: /* glsl */ `
    // estratos ondulados, más oscuro hacia abajo y banda húmeda justo encima del agua
    float s = sin(vW.y * 8. + vnoise(vW.xz * .9) * 4.);
    diffuseColor.rgb *= (.9 + .1 * smoothstep(-.3, .3, s)) * (.93 + .12 * vnoise(vW.xz * 4. + vW.y * 5.));
    diffuseColor.rgb *= mix(.6, 1.04, smoothstep(-2.4, -.5, vW.y)) * mix(.78, 1., smoothstep(-1.52, -1.32, vW.y));`,
});

const PATH = shaded({ color: C.path, roughness: 1 }, {
  key: 'path',
  color: 'diffuseColor.rgb *= (.92 + .14 * vnoise(vW.xz * 1.6)) * (1. - .1 * smoothstep(.62, .8, vnoise(vW.xz * 7.)));',
});

// Agua: superficie plana; el movimiento está en la normal (ondas suaves), el color (más claro en lo
// poco profundo), unas líneas de luz tipo cáustica, espuma en la orilla y destellos. Mar y estanque
// comparten el código y cambian la distancia a la orilla y unas constantes.
const WATER_HEAD = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
float cells(vec2 p, float t) { // distancia al borde de la celda de Voronoi más cercana, con bordes curvados
  p += (vec2(vnoise(p * .8 + t * .2), vnoise(p * .8 + 7.1 - t * .2)) - .5) * 1.1; // la deformación animada es lo que mueve las celdas
  vec2 i = floor(p), f = fract(p);
  float d1 = 8., d2 = 8.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y), o = .1 + .8 * vec2(h21(i + g), h21(i + g + 17.3));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
vec2 ripple(vec2 p, float t) { // pendiente de la superficie
  vec2 g = vec2(.95, .3) * .05 * cos(dot(vec2(.95, .3), p) * 1.2 + t * .9);
  g += vec2(-.37, .93) * .045 * cos(dot(vec2(-.37, .93), p) * 1.9 + t * 1.2);
  g += vec2(.6, -.8) * .035 * cos(dot(vec2(.6, -.8), p) * 3.1 + t * 1.6);
  return g + vec2(-.85, -.52) * .03 * cos(dot(vec2(-.85, -.52), p) * 4.7 + t * 2.1);
}
float sparkle(vec2 p, float t, float density) {
  vec2 i = floor(p), f = fract(p), o = .2 + .6 * vec2(h21(i), h21(i + 7.7));
  float tw = pow(.5 + .5 * sin(t * (1.2 + 2. * h21(i + 1.3)) + 6.2831 * h21(i + 9.1)), 8.);
  return step(1. - density, h21(i + 3.1)) * tw * (1. - smoothstep(0., .1, length(f - o)));
}`;

const waterUniforms = () => ({ uTime, uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uSky: { value: new THREE.Color() } });
const waterMat = (key: string, head: string, color: string, k: { wave: number; refl: number; spark: number; dens: number }) => {
  const uniforms = waterUniforms();
  // Rugosidad media: el sol deja un brillo suave, no una franja blanca, gire como gire la isla.
  const mat = shaded({ roughness: 0.55 }, {
    key, uniforms, head: WATER_HEAD + head,
    color: `vec2 p = vW.xz; float t = uTime;\n${color}`,
    // la amplitud varía por zonas para que las ondas no formen bandas regulares
    normal: `vec2 g = ripple(vW.xz * ${f(k.wave)}, uTime) * ${f(1 / k.wave)} * (.35 + 1.1 * vnoise(vW.xz * .22 + uTime * .05));
      normal = normalize((viewMatrix * vec4(-g.x, 1., -g.y, 0.)).xyz);`,
    light: `outgoingLight = mix(outgoingLight, uSky, smoothstep(.3, .6, 1. - dot(normal, vec3(0., 0., 1.))) * ${f(k.refl)});
      outgoingLight += sparkle(vW.xz * ${f(k.spark)}, uTime, ${f(k.dens)}) * .8;`,
  });
  return { mat, uniforms };
};

const SEA = waterMat('sea', /* glsl */ `
  const vec3 ROCKS[${SHORE_ROCKS.length}] = vec3[](${SHORE_ROCKS.map(({ p: [x, y, z], s }) => {
    const [sx, sy, sz] = s as V3; // radio de la roca a la altura del agua
    return `vec3(${f(x)}, ${f(z)}, ${f(((sx + sz) / 2) * Math.sqrt(Math.max(0, 1 - ((-1.5 - y) / sy) ** 2)))})`;
  }).join(', ')});
  float shore(vec2 p) { // distancia aproximada a la orilla (pared de tierra y rocas)
    float a = atan(p.y / ${f(RZ)}, p.x / ${f(RX)});
    float e = 1. + .05 * sin(3. * a + 1.) + .03 * sin(5. * a + 2.);
    float d = length(p) - length(vec2(cos(a) * ${f(RX)}, sin(a) * ${f(RZ)})) * e * .985 - .3;
    for (int i = 0; i < ${SHORE_ROCKS.length}; i++) d = min(d, length(p - ROCKS[i].xy) - ROCKS[i].z);
    return d;
  }`, /* glsl */ `
  float d = shore(p), sh = exp(-max(d, 0.) * .45);
  vec3 col = mix(uDeep, uShallow, sh) * (.95 + .1 * vnoise(p * .06 + t * .02));
  float c = 1. - smoothstep(0., .28, cells(p * .42 + vec2(t * .02, 0.), t * .4));
  col = mix(col, uShallow * 1.25, c * (.08 + .2 * sh));
  // espuma pegada a la orilla + una ola fina que se aleja y se desvanece
  if (d < 2.) { // lejos de la orilla no hay espuma: se ahorra el ruido
    float foam = 1. - smoothstep(.04, .26, d + .1 * vnoise(p * 2.2 + t * .5));
    float w = fract(t * .08);
    foam = max(foam, (1. - smoothstep(0., .08, abs(d - .2 - w * 1.4 + .15 * vnoise(p * 1.5)))) * (1. - w) * .4 * smoothstep(.3, .6, vnoise(p * .9 + 3.)) * step(0., d));
    col = mix(col, vec3(.97, .99, 1.), clamp(foam, 0., 1.) * .9);
  }
  diffuseColor.rgb = col;`,
{ wave: 1, refl: 0.16, spark: 2.2, dens: 0.04 });

const POND = waterMat('pond', /* glsl */ `
  float pondDist(vec2 p) { return (1. - ${pondField(0)}) * 1.2; }`, /* glsl */ `
  float d = pondDist(p);
  vec3 col = mix(uDeep, uShallow, 1. - smoothstep(0., .9, d));
  col = mix(col, uShallow * 1.15, (1. - smoothstep(0., .35, cells(p * .9, t * .5))) * .14);
  diffuseColor.rgb = mix(col, vec3(.92, .98, 1.), (1. - smoothstep(.02, .14, d + .05 * vnoise(p * 6. + t))) * .55);`,
{ wave: 2, refl: 0.2, spark: 4, dens: 0.18 });

function isFree(x: number, z: number) {
  if (!inEllipse(x, z, 0, 0, RX - 0.9, RZ - 0.9)) return false;
  if (PATH_PTS.some(p => Math.hypot(p.x - x, p.z - z) < p.w + 0.3)) return false;
  if (PONDS.some(p => inEllipse(x, z, p.x, p.z, p.rx + 0.5, p.rz + 0.5))) return false;
  if (BLOCKED_RECTS.some(r => inRect(x, z, r))) return false;
  return !BLOCKED_SPOTS.some(([sx, sz, r]) => Math.hypot(sx - x, sz - z) < r);
}

function scatterFree(seed: number, count: number, make: (x: number, z: number, r: () => number) => Item | Item[]) {
  const r = rng(seed), out: Item[] = [];
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const x = (r() * 2 - 1) * RX, z = (r() * 2 - 1) * RZ;
    if (isFree(x, z)) out.push(...[make(x, z, r)].flat());
  }
  return out;
}

// Caminos: cinta plana con ancho ondulado a lo largo de cada curva (sin costuras, una malla por camino).
function PathRibbons() {
  const geos = useMemo(() => PATHS.map(({ pts, w }, k) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const n = Math.ceil(curve.getLength() / 0.25), left: THREE.Vector2[] = [], right: THREE.Vector2[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, p = curve.getPointAt(u), tg = curve.getTangentAt(u);
      const ww = w * (1 + 0.12 * Math.sin(u * 37 + k) + 0.08 * Math.sin(u * 91 + 2 * k));
      left.push(new THREE.Vector2(p.x - tg.z * ww, -(p.z + tg.x * ww)));
      right.push(new THREE.Vector2(p.x + tg.z * ww, -(p.z - tg.x * ww)));
    }
    const g = new THREE.ShapeGeometry(new THREE.Shape([...left, ...right.reverse()]));
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.015 + k * 0.003, 0);
    return g;
  }), []);
  const [ex, ez] = PATHS[1].pts.at(-1)!;
  return (
    <>
      {geos.map((g, i) => <mesh key={i} geometry={g} material={PATH} receiveShadow />)}
      <mesh position={[ex, 0.019, ez]} rotation-x={-Math.PI / 2} material={PATH} receiveShadow><circleGeometry args={[PATHS[1].w, 20]} /></mesh>
    </>
  );
}

function fence(points: [number, number][]) {
  const posts: Item[] = [], rails: Item[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), n = Math.max(1, Math.round(len / 0.75));
    for (let k = 0; k <= n; k++) if (k < n || i === points.length - 2) posts.push({ p: [x0 + (dx * k) / n, 0.35, z0 + (dz * k) / n], s: [0.13, 0.7, 0.13] });
    for (const y of [0.3, 0.55]) rails.push({ p: [(x0 + x1) / 2, y, (z0 + z1) / 2], s: [len, 0.08, 0.06], r: Math.atan2(-dz, dx) });
  }
  return { posts, rails };
}

// ---------- Piezas ----------

function Ground() {
  const geos = useMemo(() => {
    const shape = (k: number) => new THREE.Shape(Array.from({ length: 96 }, (_, i) => {
      const [x, z] = edgeAt((i / 96) * Math.PI * 2, k);
      return new THREE.Vector2(x, -z); // y de la shape = -z del mundo (tras rotar)
    }));
    const slab = (s: THREE.Shape, depth: number, bevel: number, top: number) => {
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 1 });
      g.rotateX(-Math.PI / 2);
      g.translate(0, top - depth - bevel, 0);
      return smoothSlab(g, top, top - depth - 2 * bevel);
    };
    const grass = shape(1);
    grass.holes.push(new THREE.Path(pondOutline(POND_GROW)));
    const pond = new THREE.ShapeGeometry(new THREE.Shape(pondOutline(POND_GROW)));
    pond.rotateX(-Math.PI / 2);
    return { grass: slab(grass, 0.3, 0.3, 0), dirt: slab(shape(0.985), 1.7, 0.3, -0.42), pond };
  }, []);
  return (
    <>
      <mesh geometry={geos.grass} material={GRASS} receiveShadow />
      <mesh geometry={geos.dirt} material={DIRT} receiveShadow castShadow />
      <mesh geometry={geos.pond} material={POND.mat} position-y={POND_Y} receiveShadow />
    </>
  );
}

// Mar alrededor de la isla. La espuma de la orilla la pinta el propio shader (ver SEA).
function Water({ color, sky }: { color: string; sky: string }) {
  useEffect(() => {
    const deep = new THREE.Color(color);
    SEA.uniforms.uDeep.value.copy(deep);
    SEA.uniforms.uShallow.value.copy(deep).offsetHSL(-0.035, 0.02, 0.09); // turquesa claro junto a la orilla
    POND.uniforms.uDeep.value.copy(deep).offsetHSL(-0.03, 0.02, 0.03);
    POND.uniforms.uShallow.value.copy(deep).offsetHSL(-0.06, 0.06, 0.17);
    for (const u of [SEA.uniforms, POND.uniforms]) u.uSky.value.set(sky);
  }, [color, sky]);
  useFrame(({ clock }) => { uTime.value = clock.elapsedTime; });
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -1.5, 0]} material={SEA.mat} receiveShadow>
      <planeGeometry args={[160, 160]} />
    </mesh>
  );
}

// Piedra (zócalo y chimenea): sillares en hileras alternas con juntas más oscuras.
const STONE = /* glsl */ `
  vec2 b = vec2(vW.x + vW.z, vW.y) * vec2(2.6, 5.);
  b.x += mod(floor(b.y), 2.) * .5;
  vec2 e = min(fract(b), 1. - fract(b)) / vec2(2.6, 5.);
  diffuseColor.rgb *= (.9 + .18 * h21(floor(b))) * mix(.72, 1., smoothstep(.006, .022, min(e.x, e.y)));`;
// Tejado: hileras de tejas (sombra bajo la de encima), juntas alternas y un tono distinto por teja.
// Las juntas se desvanecen con fwidth cuando la casa se ve pequeña (sin moiré).
const ROOF = /* glsl */ `
  float k = vL.y * 4.2 + .045 * sin(vL.x * 4.), id = floor(k), row = fract(k);
  float u = vL.x * 2.1 + id * .5, sx = fract(u);
  diffuseColor.rgb *= (.92 + .14 * h21(vec2(floor(u), id))) * mix(.68, 1.04, 1. - smoothstep(.4, 1., row));
  diffuseColor.rgb *= mix(1. - .1 * (1. - smoothstep(0., .08, min(sx, 1. - sx))), 1., smoothstep(.05, .15, fwidth(u)));
  diffuseColor.rgb *= mix(.8, 1.05, smoothstep(0., 1.4, vL.y));`;
const HOUSE_MAT = {
  base: shaded({ color: '#c9baa3', roughness: 0.95 }, { key: 'stone', color: STONE }),
  wall: shaded({ color: '#f4dfbd', roughness: 0.9 }, { key: 'vary', color: VARY }),
  chimney: shaded({ color: '#b4aca2', roughness: 0.95 }, { key: 'stone', color: STONE }),
  roof: shaded({ color: '#d6a05e', roughness: 1 }, { key: 'roof', color: ROOF }),
};

function House({ glow }: { glow: number }) {
  const roof = useMemo(() => {
    const s = new THREE.Shape([new THREE.Vector2(-1.85, 0), new THREE.Vector2(1.85, 0), new THREE.Vector2(0, 1.55)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 3.4, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14, bevelSegments: 3 });
    g.translate(0, 0, -1.7);
    g.rotateY(Math.PI / 2);
    return g;
  }, []);
  const smoke = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    smoke.current.children.forEach((m, i) => {
      const k = (clock.elapsedTime * 0.25 + i / 3) % 1;
      m.position.set(Math.sin(k * 4 + i) * 0.15, k * 1.6, 0);
      m.scale.setScalar(0.12 + k * 0.3);
      ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.7 * (1 - k);
    });
  });
  const win = <meshStandardMaterial color="#ffd27a" emissive="#ffb347" emissiveIntensity={0.25 + glow * 1.8} />;
  const frame = <meshStandardMaterial color={C.woodDark} roughness={0.85} />;
  return (
    <group position={[HOUSE.x, 0, HOUSE.z]}>
      <RBox args={[3.15, 0.36, 2.75]} radius={0.08} position={[0, 0.18, 0]} material={HOUSE_MAT.base} castShadow receiveShadow />
      <RBox args={[3, 2.1, 2.6]} radius={0.07} position={[0, 1.2, 0]} material={HOUSE_MAT.wall} castShadow receiveShadow />
      <mesh geometry={roof} position={[0, 2.2, 0]} material={HOUSE_MAT.roof} castShadow receiveShadow />
      <mesh position={[0, 3.78, 0]} rotation-z={Math.PI / 2} castShadow><capsuleGeometry args={[0.15, 3.45, 4, 12]} /><meshStandardMaterial color="#b27a45" roughness={0.95} /></mesh>
      <RBox args={[0.5, 1.4, 0.5]} radius={0.05} position={[-0.8, 3.2, -0.5]} material={HOUSE_MAT.chimney} castShadow />
      <group ref={smoke} position={[-0.8, 4.0, -0.5]}>
        {[0, 1, 2].map(i => <mesh key={i} geometry={SPHERE}><meshStandardMaterial color="#ffffff" transparent depthWrite={false} /></mesh>)}
      </group>
      {/* puerta, pomo, ventanas (con marco), farol */}
      <RBox args={[0.8, 1.3, 0.12]} radius={0.06} position={[0.35, 0.95, 1.31]}><meshStandardMaterial color={C.woodDark} /></RBox>
      <mesh geometry={SPHERE} position={[0.6, 0.95, 1.39]} scale={0.05}><meshStandardMaterial color="#e8c35a" /></mesh>
      <RBox args={[0.74, 0.74, 0.08]} radius={0.035} position={[-0.85, 1.35, 1.3]}>{frame}</RBox>
      <RBox args={[0.6, 0.6, 0.08]} radius={0.03} position={[-0.85, 1.35, 1.32]}>{win}</RBox>
      <RBox args={[0.74, 0.74, 0.08]} radius={0.035} position={[-1.5, 1.35, 0]} rotation-y={Math.PI / 2}>{frame}</RBox>
      <RBox args={[0.6, 0.6, 0.08]} radius={0.03} position={[-1.52, 1.35, 0]} rotation-y={Math.PI / 2}>{win}</RBox>
      <RBox args={[0.18, 0.26, 0.18]} radius={0.04} position={[1.05, 1.55, 1.38]}>{win}</RBox>
      <pointLight position={[0.6, 1.4, 2.0]} color="#ffb357" intensity={glow * 3} distance={5} decay={1.5} />
      {/* hiedra */}
      <Scatter geo={LEAF} mat={MAT.leaf} items={[[-1.4, 2.0, 1.3, 0.22], [-1.2, 1.7, 1.33, 0.18], [-1.45, 1.5, 1.3, 0.2], [1.3, 2.0, 1.32, 0.2], [1.45, 1.75, 1.2, 0.18], [-0.3, 2.15, 1.33, 0.16]]
        .map(([x, y, z, s], i) => ({ p: [x, y, z] as V3, s, r: i * 2.1, c: C.leaf[Math.round(s * 10) % 3] }))} />
    </group>
  );
}

function Campfire({ glow }: { glow: number }) {
  const flames = useRef<THREE.Group>(null!);
  const light = useRef<THREE.PointLight>(null!);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime, f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06;
    flames.current.scale.set(1, f, 1);
    light.current.intensity = (0.6 + glow * 4) * f;
  });
  const stones = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    return { p: [Math.cos(a) * 0.48, 0.07, Math.sin(a) * 0.48] as V3, s: [0.16, 0.12, 0.14] as V3, r: a * 3 };
  });
  return (
    <group position={[FIRE.x, 0, FIRE.z]}>
      <Scatter geo={ROCK} mat={MAT.rock} items={stones} color={C.rock} />
      <mesh position={[0, 0.1, 0]} rotation={[0, 0.5, Math.PI / 2]} scale={[0.07, 0.6, 0.07]} geometry={CYL} castShadow><meshStandardMaterial color={C.woodDark} /></mesh>
      <mesh position={[0, 0.12, 0]} rotation={[0, -0.7, Math.PI / 2]} scale={[0.07, 0.6, 0.07]} geometry={CYL} castShadow><meshStandardMaterial color={C.trunk} /></mesh>
      <group ref={flames} position={[0, 0.15, 0]}>
        <mesh geometry={CONE} position={[0, 0.25, 0]} scale={[0.22, 0.55, 0.22]}><meshBasicMaterial color="#ff8a2b" toneMapped={false} /></mesh>
        <mesh geometry={CONE} position={[0, 0.2, 0.02]} scale={[0.12, 0.38, 0.12]}><meshBasicMaterial color="#ffd84d" toneMapped={false} /></mesh>
      </group>
      <pointLight ref={light} position={[0, 0.7, 0]} color="#ff9a3c" distance={7} decay={1.5} />
    </group>
  );
}

function Bridge() {
  const { planks, rails } = useMemo(() => {
    const arc = (t: number, y0: number) => new THREE.Vector3(-1.6 + 3.2 * t, y0 + 0.45 * Math.sin(Math.PI * t), 0);
    const planks = Array.from({ length: 11 }, (_, i) => {
      const t = (i + 0.5) / 11, p = arc(t, 0.12), slope = Math.atan(0.45 * Math.PI * Math.cos(Math.PI * t) / 3.2);
      return { p, slope };
    });
    const rails = [-0.5, 0.5].map(z => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => arc(i / 8, 0.6).setZ(z))), 24, 0.04, 6));
    return { planks, rails };
  }, []);
  return (
    <group position={[5.55, 0, 3.15]} rotation-y={-1.2}>
      {planks.map(({ p, slope }, i) => (
        <mesh key={i} geometry={BOX} position={p} rotation-z={slope} scale={[0.27, 0.08, 1.05]} castShadow receiveShadow><meshStandardMaterial color={i % 2 ? C.wood : '#b57a4a'} /></mesh>
      ))}
      {rails.map((g, i) => <mesh key={i} geometry={g} castShadow><meshStandardMaterial color={C.woodDark} /></mesh>)}
      <Scatter geo={BOX} color={C.woodDark} items={[-1.55, 1.55].flatMap(x => [-0.5, 0.5].map(z => ({ p: [x, 0.25, z] as V3, s: [0.1, 0.9, 0.1] as V3 })))} />
    </group>
  );
}

function StringLights() {
  const { wires, bulbs } = useMemo(() => {
    const spans: [V3, V3][] = [[[-0.6, 2.5, -6.4], [1.9, 2.5, -6.6]], [[1.9, 2.5, -6.6], [3.4, 2.4, -4.4]]];
    const bulbs: Item[] = [];
    const wires = spans.map(([a, b]) => {
      const pts = Array.from({ length: 9 }, (_, i) => {
        const t = i / 8;
        return new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 0.45 * Math.sin(Math.PI * t), a[2] + (b[2] - a[2]) * t);
      });
      pts.slice(1, -1).forEach(v => bulbs.push({ p: [v.x, v.y - 0.08, v.z], s: 0.07 }));
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 4);
    });
    return { wires, bulbs };
  }, []);
  return (
    <>
      <Scatter geo={CYL} color={C.trunk} items={[{ p: [-0.6, 1.3, -6.4], s: [0.07, 2.6, 0.07] }, { p: [1.9, 1.3, -6.6], s: [0.07, 2.6, 0.07] }]} />
      {wires.map((g, i) => <mesh key={i} geometry={g}><meshBasicMaterial color="#5a4632" /></mesh>)}
      <Scatter geo={SPHERE} items={bulbs} color="#ffe28a" glow shadow={false} />
    </>
  );
}

function Picnic() {
  const tex = useMemo(() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#f7c9d4' : '#fff6ee'; g.fillRect(i * 8, j * 8, 8, 8); }
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  return (
    <group position={[3.4, 0, -3.3]} rotation-y={0.15}>
      <mesh position={[0, 0.025, 0]} receiveShadow><boxGeometry args={[2.0, 0.05, 1.5]} /><meshStandardMaterial map={tex} /></mesh>
      {([[-0.6, -0.35, '#f4a6c0'], [0.2, -0.5, '#b9a2e8'], [0.65, 0.15, '#f7b58a']] as const).map(([x, z, c], i) => (
        <RBox key={i} args={[0.55, 0.18, 0.45]} radius={0.08} position={[x, 0.14, z]} rotation-y={i * 0.4} castShadow><meshStandardMaterial color={c} /></RBox>
      ))}
    </group>
  );
}

function Bench() {
  return (
    <group position={[8.0, 0, -2.6]} rotation-y={0.35}>
      <Scatter geo={BOX} color={C.wood} items={[{ p: [0, 0.45, 0], s: [1.4, 0.1, 0.45] }, { p: [0, 0.78, -0.2], s: [1.4, 0.38, 0.08] }]} />
      <Scatter geo={BOX} color={C.woodDark} items={[-0.6, 0.6].flatMap(x => [-0.15, 0.15].map(z => ({ p: [x, 0.22, z] as V3, s: [0.09, 0.44, 0.09] as V3 })))} />
    </group>
  );
}

function PetCorner() {
  return (
    <>
      {/* cama */}
      <group position={[BED.x, 0, BED.z]}>
        <mesh position={[0, 0.06, 0]} scale={[0.46, 0.1, 0.46]} geometry={CYL} receiveShadow><meshStandardMaterial color="#efe0ff" /></mesh>
        <mesh position={[0, 0.13, 0]} rotation-x={-Math.PI / 2} castShadow receiveShadow><torusGeometry args={[0.46, 0.15, 10, 28]} /><meshStandardMaterial color="#c6a4ea" /></mesh>
      </group>
      {/* cuencos: comida y agua */}
      <group position={[8.3, 0, 1.0]}>
        <mesh position={[0, 0.08, 0]} castShadow><cylinderGeometry args={[0.3, 0.22, 0.16, 20]} /><meshStandardMaterial color="#4f8fdc" /></mesh>
        <mesh position={[0, 0.155, 0]} scale={[0.25, 0.02, 0.25]} geometry={CYL}><meshStandardMaterial color="#9a5b2c" /></mesh>
      </group>
      <group position={[8.9, 0, 1.45]}>
        <mesh position={[0, 0.08, 0]} castShadow><cylinderGeometry args={[0.28, 0.2, 0.16, 20]} /><meshStandardMaterial color="#ef8e9c" /></mesh>
        <mesh position={[0, 0.155, 0]} scale={[0.23, 0.02, 0.23]} geometry={CYL}><meshStandardMaterial color="#8fd3f4" /></mesh>
      </group>
    </>
  );
}

function Dock({ glow }: { glow: number }) {
  const a = 0.87, [x, z] = edgeAt(a), dir = Math.atan2(Math.cos(a) / RX, Math.sin(a) / RZ);
  const planks = Array.from({ length: 8 }, (_, i) => ({ p: [0, -0.32, -0.1 + i * 0.32] as V3, s: [1.1, 0.08, 0.27] as V3, c: i % 2 ? C.wood : '#b57a4a' }));
  const posts = [-0.5, 0.5].flatMap(px => [0.3, 2.1].map(pz => ({ p: [px, -0.8, pz] as V3, s: [0.09, 1.2, 0.09] as V3 })));
  return (
    <group position={[x, 0, z]} rotation-y={dir}>
      <Scatter geo={BOX} items={planks} />
      <Scatter geo={CYL} items={posts} color={C.woodDark} />
      <RBox args={[0.16, 0.22, 0.16]} radius={0.03} position={[0.5, -0.05, 2.1]}><meshStandardMaterial color="#ffd27a" emissive="#ffb347" emissiveIntensity={0.3 + glow * 2} /></RBox>
    </group>
  );
}

// ---------- Isla ----------

export default function Island({ waterColor, sky, glow }: { waterColor: string; sky: string; glow: number }) {
  const d = useMemo(() => {
    const r = rng(7);
    const stones: Item[] = Array.from({ length: 8 }, (_, i) => {
      const t = i / 7, x = -0.9 + (-4.4) * t, z = 0.4 + (-1.4) * t;
      return { p: [x + (i % 2 ? 0.18 : -0.18) * 0.5, 0.03, z + (i % 2 ? 0.2 : -0.2)], s: [0.32 + r() * 0.1, 0.05, 0.24 + r() * 0.08] };
    });

    const trunks: Item[] = TREES.map(([x, z, s]) => ({ p: [x, s, z], s: [0.24 * s, 2 * s, 0.24 * s] }));
    const canopy: Item[] = TREES.flatMap(([x, z, s], i) => {
      const a = i * 1.7, ca = Math.cos(a), sa = Math.sin(a);
      return CANOPY.map(([ox, oy, oz, os], j): Item => ({ p: [x + (ox * ca - oz * sa) * s, oy * s, z + (ox * sa + oz * ca) * s], s: [os * s, os * s * 0.92, os * s], r: i * 1.3 + j * 2.4, c: C.leaf[(i + j) % 3] }));
    });

    const bushes: Item[] = [], bushFlowers: Item[] = [];
    BUSHES.forEach(([x, z, s, flowers], i) => {
      ([[0, 0.35, 0, 0.5], [0.38, 0.28, 0.1, 0.38], [-0.35, 0.27, -0.05, 0.4]] as const).forEach(([ox, oy, oz, os], j) =>
        bushes.push({ p: [x + ox * s, oy * s, z + oz * s], s: os * s, r: i * 2.7 + j, c: j === 1 ? C.leaf[i % 3] : C.bush }));
      if (flowers) for (let k = 0; k < 6; k++) {
        const a = k * 1.1 + i, h = 0.25 + (k % 3) * 0.12;
        bushFlowers.push({ p: [x + Math.cos(a) * 0.42 * s, h * s + 0.15, z + Math.sin(a) * 0.42 * s + 0.08], s: 0.06, c: k % 2 ? '#ff9fc4' : '#ffffff' });
      }
    });

    const rocks: Item[] = [...SHORE_ROCKS, ...([[-7.2, 4.4, 0.5], [-7.9, 3.9, 0.35], [1.2, 5.7, 0.45], [1.9, 5.4, 0.3], [-4.2, -4.7, 0.3]] as const).map(([x, z, s]) => ({ p: [x, s * 0.4, z] as V3, s: [s, s * 0.75, s * 0.85] as V3 }))];

    const flowerColors = ['#ffe066', '#ffffff', '#ff9fc4', '#c9a3ff', '#ffb36b'];
    const flowers = scatterFree(11, 150, (x, z, rr) => ({ p: [x, 0.09, z], s: 0.065 + rr() * 0.03, c: flowerColors[Math.floor(rr() * flowerColors.length)] }));
    const tufts = scatterFree(23, 170, (x, z, rr) => ({ p: [x, 0.11, z], s: [0.05, 0.22 + rr() * 0.12, 0.05], c: rr() > 0.5 ? '#78b84a' : '#6aa843' }));

    // nenúfares y flores flotando sobre el agua del estanque (hundida a POND_Y)
    const lilies: Item[] = ([[3.0, 3.0], [4.6, 3.9], [3.6, 4.2], [6.9, 2.7], [2.6, 3.8]] as const).map(([x, z], i) => ({ p: [x, POND_Y + 0.012, z], s: [0.26 - i * 0.02, 0.015, 0.26 - i * 0.02], c: '#5a9e3a' }));
    const lotus: Item[] = [{ p: [4.6, POND_Y + 0.055, 3.9], s: 0.08, c: '#ff9fc4' }, { p: [3.0, POND_Y + 0.055, 3.0], s: 0.07, c: '#ffffff' }];
    const reedSpots = [[2.0, 4.3], [2.2, 4.6], [1.8, 4.0], [7.7, 3.4], [7.9, 3.1], [5.2, 4.6]];
    const reeds: Item[] = reedSpots.map(([x, z], i) => ({ p: [x, 0.35, z], s: [0.03, 0.9 + (i % 3) * 0.15, 0.03] })); // pie dentro de la orilla
    const reedTops: Item[] = reedSpots.map(([x, z], i) => ({ p: [x, 0.85 + (i % 3) * 0.075, z], s: [0.06, 0.16, 0.06] }));

    const gardenFence = fence([[-8.9, 2.95], [-5.85, 2.95], [-5.85, 0.35]]);
    const pathFence = fence([[-1.5, 6.1], [-0.4, 6.4]]);
    const sprouts: Item[] = [];
    for (let row = 0; row < 3; row++) for (let k = 0; k < 5; k++) sprouts.push({ p: [-8.4 + k * 0.5, 0.3, 0.9 + row * 0.6], s: [0.1, 0.24, 0.1], c: k % 2 ? '#5fa83a' : '#7cc24e' });

    return { stones, trunks, canopy, bushes, bushFlowers, rocks, flowers, tufts, lilies, lotus, reeds, reedTops,
      posts: [...gardenFence.posts, ...pathFence.posts], rails: [...gardenFence.rails, ...pathFence.rails], sprouts };
  }, []);

  return (
    <group>
      <Water color={waterColor} sky={sky} />
      <Ground />
      <PathRibbons />
      <Scatter geo={ROCK} mat={MAT.rock} items={d.stones} color={C.stone} shadow={false} />
      <Scatter geo={TRUNK} items={d.trunks} color={C.trunk} />
      <Scatter geo={LEAF} mat={MAT.leaf} items={d.canopy} />
      <Scatter geo={LEAF} mat={MAT.leaf} items={d.bushes} />
      <Scatter geo={SPHERE} items={d.bushFlowers} shadow={false} />
      <Scatter geo={ROCK} mat={MAT.rock} items={d.rocks} color={C.rock} />
      <Scatter geo={SPHERE} items={d.flowers} shadow={false} />
      <Scatter geo={CONE} items={d.tufts} shadow={false} />
      <Scatter geo={CYL} items={d.lilies} shadow={false} />
      <Scatter geo={SPHERE} items={d.lotus} shadow={false} />
      <Scatter geo={CYL} items={d.reeds} color="#6aa843" />
      <Scatter geo={SPHERE} items={d.reedTops} color="#8a5a3b" />
      <Scatter geo={BOX} items={d.posts} color={C.woodDark} />
      <Scatter geo={BOX} items={d.rails} color={C.wood} />
      {/* huerto */}
      <Scatter geo={BOX} items={[{ p: [-7.4, 0.08, 1.6], s: [2.6, 0.16, 2.0] }]} color="#8a5a3a" shadow={false} />
      <Scatter geo={CONE} items={d.sprouts} />
      <House glow={glow} />
      <Campfire glow={glow} />
      <Bridge />
      <StringLights />
      <Picnic />
      <Bench />
      <PetCorner />
      <Dock glow={glow} />
    </group>
  );
}
