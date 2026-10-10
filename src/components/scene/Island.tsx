'use client';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { rng, uTime, shaded, VARY, smoothSlab } from './materials';
import {
  ROCKS, ROCKS_LO, ROCK_HW, FLAGS, TREE_KINDS, BUSH_KINDS, IVY, TUFTS, SPROUT, FLOWER, FLOWER_CORE, BLOSSOM_CORE, LOTUS, LILY_PAD,
  CATTAIL, LOG, FLAME, SHINGLE, post,
} from './shapes';
import { NODES, EDGES } from './nav';

// Isla generada por código (sin modelos externos). Mundo: x derecha, z hacia la cámara (sur), y arriba.
// La hierba está en y = 0. Las posiciones de los sitios coinciden con los nodos de nav.ts.
// Los modelos (rocas, árboles, hierba, flores...) están en shapes.ts; aquí se colocan.

export const RX = 9.6;
export const RZ = 7.4;
const edgeR = (a: number) => 1 + 0.05 * Math.sin(3 * a + 1) + 0.03 * Math.sin(5 * a + 2);
const edgeAt = (a: number, k = 1): [number, number] => [Math.cos(a) * RX * edgeR(a) * k, Math.sin(a) * RZ * edgeR(a) * k];

const C = {
  grass: '#9ccb5e', dirt: '#c48e5c', path: '#e2bd86', stone: '#d4cbbd', rock: '#bdb5aa',
  trunk: '#8a5a3b', wood: '#a86f42', woodDark: '#8b5a33', leaf: ['#7cbf4e', '#8ed05c', '#6db347'],
  bush: '#6aad45', rim: '#d9c99c',
};
const WOODS = ['#a86f42', '#b57a4a', '#9c6640', '#b0784a', '#a26a3f'];
const DARK_WOODS = ['#8b5a33', '#7f5230', '#93603a'];
const GRASS_TONES = ['#78b84a', '#6aa843', '#86c254'];
const pick = <T,>(a: T[], r: () => number) => a[Math.floor(r() * a.length)];

const SPHERE = new THREE.SphereGeometry(1, 16, 12);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const BOX = new RoundedBoxGeometry(1, 1, 1, 2, 0.14); // cantos redondeados; con escala no uniforme el bisel se adapta a cada pieza
const MOUND = new THREE.CapsuleGeometry(0.5, 4, 4, 12).rotateZ(Math.PI / 2); // caballón del huerto
const FENCE_POST = post(0.13, 0.64);
const POST = post(0.11, 1); // se estira en y por instancia
const CANOPIES = TREE_KINDS.map(k => k.canopy), TRUNKS = TREE_KINDS.map(k => k.trunk), BUSH_GEOS = BUSH_KINDS.map(k => k.geo);
const Y = new THREE.Vector3(0, 1, 0);

// Vetas: ruido en coordenadas locales de la caja unidad; al escalarla se estira a lo largo de la pieza.
const WOOD = 'diffuseColor.rgb *= .88 + .2 * vnoise(vL.xy * 7. + vL.z * 5.);';
const MAT = {
  vary: shaded({ roughness: 0.9 }, { key: 'vary', color: VARY }),
  vcol: shaded({ roughness: 0.9, vertexColors: true }, { key: 'vary', color: VARY }),
  wood: shaded({ roughness: 0.85 }, { key: 'wood', color: WOOD }),
  // El volumen (pliegues, parte baja, brillo arriba) viene en el color por vértice; aquí solo manchas de tono.
  foliage: shaded({ roughness: 0.85, vertexColors: true }, { key: 'foliage', color: 'diffuseColor.rgb *= .9 + .2 * vnoise(vW.xz * .9 + vW.y * 1.4);' }),
  bark: shaded({ roughness: 0.95, vertexColors: true }, { key: 'bark', color: 'diffuseColor.rgb *= .8 + .28 * vnoise(vec2((vL.x - vL.z) * 9., vL.y * 1.4));' }),
  // Rocas (altura 1, base en 0): pie oscuro, cara de arriba clara, vetas suaves y tono algo cálido o frío por zonas.
  rock: shaded({ roughness: 0.9 }, {
    key: 'rock',
    color: /* glsl */ `
      float n = vnoise(vL.xz * 3. + vL.y * 4.) * .6 + vnoise(vW.xz * 9. + vW.y * 7.) * .4;
      diffuseColor.rgb *= mix(.64, 1.07, smoothstep(0., .6, vL.y)) * (.87 + .22 * n);
      diffuseColor.rgb *= mix(vec3(1.04, 1., .94), vec3(.95, .98, 1.03), vnoise(vW.xz * .45 + 3.));`,
  }),
};

type V3 = [number, number, number];
type Item = { p: V3; s?: number | V3; r?: number | V3; c?: string; v?: number }; // r: giro en y o Euler; v: variante

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
      const r = Array.isArray(it.r) ? it.r : [0, it.r ?? 0, 0];
      m.compose(new THREE.Vector3(...it.p), q.setFromEuler(e.set(r[0], r[1], r[2])), new THREE.Vector3(...s));
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

// Varias geometrías de la misma pieza (variantes): cada item elige la suya con `v`. Una draw call por variante.
function Variants({ geos, items, ...rest }: Omit<Parameters<typeof Scatter>[0], 'geo'> & { geos: THREE.BufferGeometry[] }) {
  const groups = useMemo(() => geos.map((_, k) => items.filter(it => (it.v ?? 0) % geos.length === k)), [geos, items]);
  return <>{groups.map((g, k) => g.length > 0 && <Scatter key={k} geo={geos[k]} items={g} {...rest} />)}</>;
}

// ---------- Layout ----------

const PATHS: { pts: [number, number][]; w: number }[] = [
  { pts: [[-3.2, 7.2], [-2.4, 4.6], [-0.8, 2.0], [0, -0.5], [0.4, -3.5], [0.6, -7.3]], w: 0.8 },
  { pts: [[0.1, -1.3], [2.5, -1.3], [4.4, -0.9], [5.3, -1.4]], w: 0.62 },
];
const PATH_CURVES = PATHS.map(({ pts, w }) => ({ w, curve: new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z))) }));
const PATH_PTS = PATH_CURVES.flatMap(({ curve, w }) => curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.22)).map(v => ({ x: v.x, z: v.z, w })));
const pathWidth = (u: number, w: number, k: number) => w * (1 + 0.12 * Math.sin(u * 37 + k) + 0.08 * Math.sin(u * 91 + 2 * k));

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
const BUSHES: [number, number, number, boolean][] = [[-3.5, -2.1, 0.8, true], [-7.3, -1.2, 0.7, false], [-8.4, 3.3, 0.8, false], [-6.0, 5.0, 0.7, true], [1.7, -4.8, 0.7, true], [-1.0, -4.8, 0.6, false], [8.4, 2.4, 0.7, false], [5.9, 5.5, 0.6, true], [-2.6, -5.2, 0.7, false], [6.4, -3.8, 0.7, true]];
const HOUSE = { x: -5.5, z: -3.0 };
const FIRE = { x: 5.9, z: -2.3 };
const BED = { x: 7.5, z: -0.4 };

const inEllipse = (x: number, z: number, cx: number, cz: number, rx: number, rz: number) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 < 1;
const inRect = (x: number, z: number, [x0, z0, x1, z1]: number[]) => x > x0 && x < x1 && z > z0 && z < z1;
const BLOCKED_RECTS = [[-7.4, -4.7, -3.6, -1.3], [-8.9, 0.4, -5.9, 2.8], [2.2, -4.3, 4.6, -2.3]];
const BLOCKED_SPOTS: V3[] = [[FIRE.x, FIRE.z, 1.0], [BED.x, BED.z, 0.8], [8.6, 1.2, 0.9], [8.0, -2.6, 0.9]];

// Roca de altura h y semiancho hw (las variantes miden 1 de alto), con la base en y.
const rockItem = (x: number, y: number, z: number, hw: number, h: number, v: number, r: number, tilt = 0): Item =>
  ({ p: [x, y, z], s: [hw / ROCK_HW[v], h, hw / ROCK_HW[v]], r: [Math.sin(r * 3) * tilt, r, Math.cos(r * 2) * tilt], v });
// Rocas de la orilla, con el pie dentro del agua (y = -1.5): [ángulo, semiancho, altura de la cima, variante].
const SHORE_ROCKS = ([[200, 1.1, 0.2, 0], [150, 0.9, -0.05, 2], [25, 1.2, 0.3, 0], [340, 0.85, -0.1, 3], [75, 0.9, -0.05, 2], [112, 0.7, -0.4, 1], [255, 0.8, -0.2, 3]] as const).map(([deg, hw, top, v]) => {
  const [x, z] = edgeAt((deg * Math.PI) / 180, 1.04);
  return { ...rockItem(x, -1.65, z, hw, top + 1.65, v, deg, 0.08), hw };
});
// Rocas sueltas por el césped: [x, z, semiancho, alto, variante]. Una grande con otra pequeña al lado.
const FIELD_ROCKS: [number, number, number, number, number][] = [[-7.2, 4.4, 0.5, 0.58, 0], [-7.85, 3.85, 0.36, 0.3, 1], [1.2, 5.7, 0.46, 0.5, 2], [1.85, 5.4, 0.32, 0.26, 3], [-4.2, -4.7, 0.3, 0.3, 0]];

// ---------- Shaders del suelo y del agua (GLSL inyectado en MeshStandardMaterial, ver materials.ts) ----------

const f = (n: number) => n.toFixed(3);
const lin = (hex: string) => new THREE.Color(hex).toArray().map(f).join(', '); // color lineal para GLSL
const pondField = (grow: number) => `min(${PONDS.map(p => `length((p - vec2(${f(p.x)}, ${f(p.z)})) / vec2(${f(p.rx + grow)}, ${f(p.rz + grow)}))`).join(', ')})`;

// Sitios que oscurecen un poco la hierba a su alrededor (oclusión de contacto): x, z, radio.
const OCCLUDERS: V3[] = [
  ...TREES.map(([x, z, s]): V3 => [x, z, 1.3 * s]),
  ...BUSHES.map(([x, z, s]): V3 => [x, z, 1.0 * s]),
  ...FIELD_ROCKS.map(([x, z, hw]): V3 => [x, z, hw * 1.45]),
  [FIRE.x, FIRE.z, 0.8], [8.0, -2.6, 1.0],
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

// Tierra del camino; el color por vértice oscurece el borde (tierra pisada) y aclara el centro.
const PATH = shaded({ color: C.path, roughness: 1, vertexColors: true }, {
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
  const vec3 ROCKS[${SHORE_ROCKS.length}] = vec3[](${SHORE_ROCKS.map(({ p: [x, , z], hw }) => `vec3(${f(x)}, ${f(z)}, ${f(hw * 0.95)})`).join(', ')});
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
  if (TREES.some(([tx, tz, s]) => Math.hypot(tx - x, tz - z) < 0.55 * s)) return false; // pie del tronco con raíces
  return !BLOCKED_SPOTS.some(([sx, sz, r]) => Math.hypot(sx - x, sz - z) < r);
}

// Lejos de las aristas por las que anda Pocky (la hierba alta no se le mete entre las patas).
const segDist = (x: number, z: number, [ax, az]: readonly number[], [bx, bz]: readonly number[]) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};
const offNav = (x: number, z: number) => EDGES.every(([a, b]) => segDist(x, z, NODES[a], NODES[b]) > 0.45);

function scatterFree(seed: number, count: number, make: (x: number, z: number, r: () => number) => Item | Item[]) {
  const r = rng(seed), out: Item[] = [];
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const x = (r() * 2 - 1) * RX, z = (r() * 2 - 1) * RZ;
    if (isFree(x, z)) out.push(...[make(x, z, r)].flat());
  }
  return out;
}

// Puntos sueltos a lo largo de los bordes de los caminos (guijarros, hierba que se mete en la tierra).
function pathEdges(seed: number, step: number, prob: number, [o0, o1]: [number, number]) {
  const r = rng(seed), out: [number, number][] = [];
  PATH_CURVES.forEach(({ curve, w }, k) => {
    const n = Math.floor(curve.getLength() / step);
    for (let i = 1; i < n; i++) for (const side of [-1, 1]) {
      if (r() > prob) continue;
      const u = Math.min(1, Math.max(0, (i + r() - 0.5) / n)), p = curve.getPointAt(u), tg = curve.getTangentAt(u);
      const d = pathWidth(u, w, k) * (o0 + r() * (o1 - o0)) * side, x = p.x - tg.z * d, z = p.z + tg.x * d;
      if (inEllipse(x, z, 0, 0, RX - 0.6, RZ - 0.6) && !PONDS.some(q => inEllipse(x, z, q.x, q.z, q.rx + 0.4, q.rz + 0.4)) && !BLOCKED_RECTS.some(b => inRect(x, z, b))) out.push([x, z]);
    }
  });
  return out;
}

// Caminos: cinta con ancho ondulado a lo largo de cada curva, cinco vértices de ancho para oscurecer el borde
// con el color por vértice. El camino corto acaba en una placita redonda.
function PathRibbons() {
  const geo = useMemo(() => {
    const P: number[] = [], Cl: number[] = [], I: number[] = [];
    const across = [-1, -0.72, 0, 0.72, 1], shade = [0.9, 1.0, 1.05, 1.0, 0.9];
    PATH_CURVES.forEach(({ curve, w }, k) => {
      const n = Math.ceil(curve.getLength() / 0.12), y = 0.015 + k * 0.003, base = P.length / 3;
      for (let i = 0; i <= n; i++) {
        const u = i / n, p = curve.getPointAt(u), tg = curve.getTangentAt(u), ww = pathWidth(u, w, k);
        across.forEach((o, j) => {
          const wl = ww * o * (Math.abs(o) === 1 ? 1 + 0.05 * Math.sin(u * 260 + j + k) : 1); // borde mordido
          P.push(p.x - tg.z * wl, y, p.z + tg.x * wl);
          Cl.push(shade[j], shade[j], shade[j]);
        });
        if (i < n) for (let j = 0; j < 4; j++) { const a = base + i * 5 + j, b = a + 5; I.push(a, a + 1, b, a + 1, b + 1, b); }
      }
    });
    const [ex, ez] = PATHS[1].pts.at(-1)!, c0 = P.length / 3, seg = 24;
    P.push(ex, 0.019, ez); Cl.push(1.05, 1.05, 1.05);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, rr = PATHS[1].w * (1 + 0.06 * Math.sin(a * 5));
      P.push(ex + Math.cos(a) * rr, 0.019, ez + Math.sin(a) * rr); Cl.push(0.9, 0.9, 0.9);
      I.push(c0, c0 + 1 + ((i + 1) % seg), c0 + 1 + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(P.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Cl, 3));
    g.setIndex(I);
    return g;
  }, []);
  return <mesh geometry={geo} material={PATH} receiveShadow />;
}

// Valla: postes con remate, algo torcidos y de alturas distintas; travesaños que atraviesan los postes.
function fence(points: [number, number][], seed: number) {
  const r = rng(seed), j = (k: number) => (r() - 0.5) * k, posts: Item[] = [], rails: Item[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), n = Math.max(1, Math.round(len / 0.75)), ry = Math.atan2(-dz, dx);
    for (let k = 0; k <= n; k++) if (k < n || i === points.length - 2) {
      posts.push({ p: [x0 + (dx * k) / n, -0.02, z0 + (dz * k) / n], s: [1, 0.94 + r() * 0.12, 1], r: [j(0.07), ry + j(0.3), j(0.07)], c: pick(DARK_WOODS, r) });
    }
    for (const y of [0.3, 0.52]) rails.push({ p: [(x0 + x1) / 2, y + j(0.03), (z0 + z1) / 2], s: [len + 0.08, 0.075, 0.055], r: [j(0.05), ry, j(0.025)], c: pick(WOODS, r) });
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
const HOUSE_MAT = {
  base: shaded({ color: '#c9baa3', roughness: 0.95 }, { key: 'stone', color: STONE }),
  // enlucido: algo más oscuro al pie (oclusión con el zócalo) y bajo el alero
  wall: shaded({ color: '#f4dfbd', roughness: 0.9 }, { key: 'wall', color: `${VARY} diffuseColor.rgb *= mix(.82, 1., smoothstep(-1.05, -.55, vL.y)) * mix(1., .84, smoothstep(.7, 1.05, vL.y));` }),
  gable: shaded({ color: '#f4dfbd', roughness: 0.9 }, { key: 'vary', color: VARY }),
  chimney: shaded({ color: '#b4aca2', roughness: 0.95 }, { key: 'stone', color: STONE }),
  // tejas: más oscuras en la parte alta de cada pieza, que queda bajo la hilera de encima
  shingle: shaded({ roughness: 1 }, { key: 'shingle', color: 'diffuseColor.rgb *= (.93 + .14 * vnoise(vL.xz * vec2(3., 9.) + vW.y)) * mix(.64, 1.06, smoothstep(-.5, .42, vL.z));' }),
  // puerta de tablas verticales con juntas
  door: shaded({ color: C.woodDark, roughness: 0.85 }, {
    key: 'door',
    color: 'float u = vL.x * 5.13 + .5, k = fract(u); diffuseColor.rgb *= (.88 + .16 * h21(vec2(floor(u), 3.))) * mix(.6, 1., smoothstep(0., .08, min(k, 1. - k)));',
  }),
  frame: shaded({ color: C.wood, roughness: 0.85 }, { key: 'wood', color: WOOD }),
};

// Arco de puerta: rectángulo con medio círculo encima (vale para Shape y para el hueco).
const arch = <T extends THREE.Path>(p: T, w: number, h: number) => {
  p.moveTo(-w / 2, 0); p.lineTo(w / 2, 0); p.lineTo(w / 2, h); p.absarc(0, h, w / 2, 0, Math.PI, false); p.lineTo(-w / 2, 0);
  return p;
};

const ROOF = { eave: 1.75, rise: 1.45, y: 2.25, half: 1.9 }; // alero a 1.75 del centro, cumbrera 1.45 por encima del muro
const PITCH = Math.atan2(ROOF.rise, ROOF.eave), SLOPE = Math.hypot(ROOF.eave, ROOF.rise);

function House({ glow }: { glow: number }) {
  const d = useMemo(() => {
    const r = rng(5), j = (k: number) => (r() - 0.5) * k;
    // hastial: pentágono de enlucido que cierra el muro hasta el tejado
    const gs = new THREE.Shape([[-1.3, 0], [1.3, 0], [1.3, 0.35], [0, 1.42], [-1.3, 0.35]].map(([x, y]) => new THREE.Vector2(x, y)));
    const gable = new THREE.ExtrudeGeometry(gs, { depth: 3.0, bevelEnabled: false });
    gable.translate(0, 0, -1.5);
    gable.rotateY(Math.PI / 2);

    // Tejas: hileras al tresbolillo, cada una algo menos inclinada que el tejado para que el borde de abajo
    // asome sobre la de debajo. Todas con un poco de giro, ancho y tono distintos.
    const shingles: Item[] = [], rows = 7, cols = 12, sw = (2 * ROOF.half) / cols;
    const at = (side: number, u: number, out: number): V3 =>
      [0, ROOF.y + ROOF.rise * u + Math.cos(PITCH) * out, side * (ROOF.eave * (1 - u) + Math.sin(PITCH) * out)];
    for (const side of [1, -1]) for (let row = 0; row < rows; row++) {
      const odd = row % 2, u = (row + 0.5) / rows;
      for (let k = 0; k < cols + odd; k++) {
        const half = odd && (k === 0 || k === cols); // las de los extremos de las hileras impares, medias
        const x = half ? (k === 0 ? -1 : 1) * (ROOF.half - sw / 4) : -ROOF.half + (k + (odd ? 0 : 0.5)) * sw;
        const [, y, z] = at(side, u, 0.05 + row * 0.006);
        shingles.push({
          p: [x + j(0.02), y, z], s: [((half ? sw / 2 : sw) - 0.02 + j(0.02)) / 1.12, 0.065, 0.45],
          r: [side * (PITCH - 0.07) + j(0.03), (side > 0 ? 0 : Math.PI) + j(0.06), j(0.05)],
          c: pick(['#d6a05e', '#cf9554', '#dcab6a', '#c98d4e', '#d9a463'], r),
        });
      }
    }
    // Madera: base del tejado (oscura, rellena las juntas), tablas de los hastiales, pies derechos y vigas.
    const wood: Item[] = [];
    for (const side of [1, -1]) {
      const [, y, z] = at(side, 0.5, 0);
      wood.push({ p: [0, y, z], s: [2 * ROOF.half + 0.04, 0.06, SLOPE + 0.12], r: [side * PITCH, 0, 0], c: '#6e4429' });
      for (const x of [-1, 1]) wood.push({ p: [x * (ROOF.half + 0.03), y, z], s: [0.08, 0.17, SLOPE + 0.1], r: [side * PITCH, 0, 0], c: C.woodDark });
    }
    for (const x of [-1, 1]) for (const z of [-1, 1]) wood.push({ p: [x * 1.47, 1.2, z * 1.27], s: [0.16, 2.1, 0.16], c: C.woodDark });
    for (const z of [-1, 1]) wood.push({ p: [0, 2.2, z * 1.33], s: [3.1, 0.14, 0.12], c: C.woodDark });
    for (const x of [-1, 1]) wood.push({ p: [x * 1.53, 2.2, 0], s: [0.12, 0.14, 2.7], c: C.woodDark });
    // ventanas: marco, cruz, alféizar y dintel (en coordenadas de la ventana, z hacia fuera)
    const glass: V3[] = [];
    for (const [ox, oz, ry] of [[-0.85, 1.3, 0], [-1.5, 0, -Math.PI / 2]]) {
      const c = Math.cos(ry), s = Math.sin(ry), w = (lx: number, ly: number, lz: number): V3 => [ox + lx * c + lz * s, 1.35 + ly, oz - lx * s + lz * c];
      wood.push(
        { p: w(0, 0, 0), s: [0.78, 0.78, 0.08], r: ry, c: C.woodDark },
        { p: w(0, 0, 0.07), s: [0.6, 0.05, 0.03], r: ry, c: C.woodDark },
        { p: w(0, 0, 0.07), s: [0.05, 0.6, 0.03], r: ry, c: C.woodDark },
        { p: w(0, -0.44, 0.07), s: [0.94, 0.07, 0.2], r: ry, c: C.wood },
        { p: w(0, 0.44, 0.04), s: [0.9, 0.08, 0.12], r: ry, c: C.wood },
      );
      glass.push(w(0, 0, 0.02));
    }
    wood.push({ p: [1.05, 1.83, 1.37], s: [0.04, 0.04, 0.16], c: '#4a3a30' }); // brazo del farol
    wood.push({ p: [-0.8, 4.0, -0.5], s: [0.3, 0.05, 0.3], c: '#3b2f2a' }); // boca de la chimenea

    const door = new THREE.ExtrudeGeometry(arch(new THREE.Shape(), 0.78, 0.98), { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 16 });
    const fs = arch(new THREE.Shape(), 1.0, 0.98);
    fs.holes.push(arch(new THREE.Path(), 0.78, 0.98));
    const frame = new THREE.ExtrudeGeometry(fs, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 16 });
    return { gable, shingles, wood, glass, door, frame };
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
  return (
    <group position={[HOUSE.x, 0, HOUSE.z]}>
      <RBox args={[3.15, 0.36, 2.75]} radius={0.08} position={[0, 0.18, 0]} material={HOUSE_MAT.base} castShadow receiveShadow />
      <RBox args={[3, 2.1, 2.6]} radius={0.07} position={[0, 1.2, 0]} material={HOUSE_MAT.wall} castShadow receiveShadow />
      <mesh geometry={d.gable} position-y={ROOF.y} material={HOUSE_MAT.gable} castShadow receiveShadow />
      <Scatter geo={SHINGLE} mat={HOUSE_MAT.shingle} items={d.shingles} shadow={false} />
      <Scatter geo={BOX} mat={MAT.wood} items={d.wood} />
      <mesh position={[0, ROOF.y + ROOF.rise + 0.06, 0]} rotation-z={Math.PI / 2} castShadow><capsuleGeometry args={[0.15, 2 * ROOF.half - 0.1, 4, 12]} /><meshStandardMaterial color="#b27a45" roughness={0.95} /></mesh>
      <RBox args={[0.5, 1.4, 0.5]} radius={0.05} position={[-0.8, 3.2, -0.5]} material={HOUSE_MAT.chimney} castShadow />
      <RBox args={[0.66, 0.14, 0.66]} radius={0.04} position={[-0.8, 3.92, -0.5]} material={HOUSE_MAT.chimney} castShadow />
      <group ref={smoke} position={[-0.8, 4.1, -0.5]}>
        {[0, 1, 2].map(i => <mesh key={i} geometry={SPHERE}><meshStandardMaterial color="#ffffff" transparent depthWrite={false} /></mesh>)}
      </group>
      {/* puerta en arco con marco, pomo y escalón */}
      <group position={[0.35, 0.36, 1.27]}>
        <mesh geometry={d.door} material={HOUSE_MAT.door} castShadow />
        <mesh geometry={d.frame} position-z={0.02} material={HOUSE_MAT.frame} castShadow />
        <mesh geometry={SPHERE} position={[0.25, 0.6, 0.13]} scale={0.045}><meshStandardMaterial color="#e8c35a" metalness={0.4} roughness={0.4} /></mesh>
      </group>
      <RBox args={[0.95, 0.2, 0.42]} radius={0.05} position={[0.35, 0.1, 1.57]} material={HOUSE_MAT.base} castShadow receiveShadow />
      {d.glass.map((p, i) => <RBox key={i} args={[0.6, 0.6, 0.08]} radius={0.03} position={p} rotation-y={i ? -Math.PI / 2 : 0}>{win}</RBox>)}
      {/* farol colgado junto a la puerta */}
      <group position={[1.05, 1.6, 1.45]}>
        <RBox args={[0.17, 0.24, 0.17]} radius={0.04}>{win}</RBox>
        <mesh position-y={0.18} rotation-y={Math.PI / 4}><coneGeometry args={[0.16, 0.13, 4]} /><meshStandardMaterial color="#4a3a30" /></mesh>
        <mesh position-y={-0.14} scale={[0.2, 0.04, 0.2]} geometry={BOX}><meshStandardMaterial color="#4a3a30" /></mesh>
      </group>
      <pointLight position={[0.6, 1.4, 2.0]} color="#ffb357" intensity={glow * 3} distance={5} decay={1.5} />
      {/* hiedra */}
      <Scatter geo={IVY} mat={MAT.foliage} items={[[-1.42, 2.0, 1.3, 0.24], [-1.5, 1.68, 1.25, 0.19], [-1.48, 1.35, 1.3, 0.2], [1.33, 2.0, 1.32, 0.22], [1.48, 1.7, 1.2, 0.18], [-0.3, 2.12, 1.33, 0.17]]
        .map(([x, y, z, s], i) => ({ p: [x, y, z] as V3, s, r: i * 2.1, c: C.leaf[i % 3] }))} />
    </group>
  );
}

function Campfire({ glow }: { glow: number }) {
  const flames = useRef<THREE.Group>(null!);
  const light = useRef<THREE.PointLight>(null!);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime, f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06;
    flames.current.scale.set(1, f, 1);
    flames.current.children.forEach((m, i) => { m.rotation.y = t * (0.6 + i * 0.3); });
    light.current.intensity = (0.6 + glow * 4) * f;
  });
  const stones = useMemo(() => Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    return rockItem(Math.cos(a) * 0.48, -0.02, Math.sin(a) * 0.48, 0.14 + (i % 3) * 0.02, 0.12 + (i % 2) * 0.05, i % 4, a * 3, 0.15);
  }), []);
  const logs: Item[] = [{ p: [0, 0.1, 0], s: [0.07, 0.62, 0.07], r: [0, 0.5, Math.PI / 2] }, { p: [0, 0.13, 0], s: [0.065, 0.56, 0.065], r: [0, -0.7, Math.PI / 2] }, { p: [0, 0.16, 0], s: [0.06, 0.5, 0.06], r: [0, 1.9, Math.PI / 2] }];
  const fire = <meshBasicMaterial vertexColors toneMapped={false} />;
  return (
    <group position={[FIRE.x, 0, FIRE.z]}>
      <Variants geos={ROCKS_LO} mat={MAT.rock} items={stones} color={C.rock} />
      <Scatter geo={LOG} mat={MAT.vcol} items={logs} />
      <group ref={flames} position={[0, 0.12, 0]}>
        <mesh geometry={FLAME} scale={[0.44, 0.72, 0.44]}>{fire}</mesh>
        <mesh geometry={FLAME} position={[0.1, 0, 0.05]} rotation-z={-0.25} scale={[0.24, 0.44, 0.24]}>{fire}</mesh>
        <mesh geometry={FLAME} position={[-0.09, 0, -0.04]} rotation-z={0.3} scale={[0.22, 0.38, 0.22]}>{fire}</mesh>
      </group>
      <pointLight ref={light} position={[0, 0.7, 0]} color="#ff9a3c" distance={7} decay={1.5} />
    </group>
  );
}

function Bridge() {
  const d = useMemo(() => {
    const r = rng(9), j = (k: number) => (r() - 0.5) * k;
    const arc = (t: number, y0: number) => new THREE.Vector3(-1.6 + 3.2 * t, y0 + 0.45 * Math.sin(Math.PI * t), 0);
    const slope = (t: number) => Math.atan((0.45 * Math.PI * Math.cos(Math.PI * t)) / 3.2);
    // tablas sueltas: cada una con su ancho, largo, tono y un pelín torcida; queda una rendija entre ellas
    const planks: Item[] = Array.from({ length: 13 }, (_, i) => {
      const t = (i + 0.5) / 13, p = arc(t, 0.12);
      return { p: [p.x, p.y, j(0.05)], s: [0.2 + j(0.03), 0.07, 1.02 + j(0.08)], r: [j(0.03), j(0.06), slope(t) + j(0.03)], c: pick(WOODS, r) };
    });
    // largueros curvos bajo los extremos de las tablas, en tramos rectos
    const beams: Item[] = [];
    for (const z of [-0.43, 0.43]) for (let k = 0; k < 10; k++) {
      const a = arc(k / 10, 0.02), b = arc((k + 1) / 10, 0.02);
      beams.push({ p: [(a.x + b.x) / 2, (a.y + b.y) / 2, z], s: [a.distanceTo(b) + 0.05, 0.13, 0.08], r: [0, 0, Math.atan2(b.y - a.y, b.x - a.x)] });
    }
    // postes (extremos y centro) y balaustres hasta el pasamanos
    const posts: Item[] = [], bars: Item[] = [];
    for (const z of [-0.5, 0.5]) {
      for (const t of [0.02, 0.5, 0.98]) {
        const base = t === 0.5 ? arc(t, 0.1).y : -0.12, top = arc(t, 0.6).y + 0.03;
        posts.push({ p: [arc(t, 0).x, base, z], s: [1, top - base, 1], c: C.woodDark });
      }
      for (const t of [0.14, 0.26, 0.38, 0.62, 0.74, 0.86]) bars.push({ p: [arc(t, 0).x, arc(t, 0.36).y, z], s: [0.035, 0.48, 0.035], c: pick(WOODS, r) });
    }
    const rails = [-0.5, 0.5].map(z => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => arc(i / 8, 0.6).setZ(z))), 32, 0.045, 8));
    // piedras planas donde apoya en cada orilla
    const stones = [-1, 1].flatMap(sx => [-1, 1].map(sz => rockItem(sx * 1.72, -0.04, sz * 0.42, 0.22, 0.14, 1, sx * 2 + sz, 0.05)));
    return { planks, beams, posts, bars, rails, stones };
  }, []);
  return (
    <group position={[5.55, 0, 3.15]} rotation-y={-1.2}>
      <Scatter geo={BOX} mat={MAT.wood} items={d.planks} />
      <Scatter geo={BOX} mat={MAT.wood} items={d.beams} color={C.woodDark} />
      <Scatter geo={POST} mat={MAT.wood} items={d.posts} />
      <Scatter geo={BOX} mat={MAT.wood} items={d.bars} />
      {d.rails.map((g, i) => <mesh key={i} geometry={g} castShadow><meshStandardMaterial color={C.woodDark} roughness={0.85} /></mesh>)}
      <Variants geos={ROCKS_LO} mat={MAT.rock} items={d.stones} color={C.rock} shadow={false} />
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
      <RBox args={[2.0, 0.04, 1.5]} radius={0.018} position={[0, 0.02, 0]} receiveShadow><meshStandardMaterial map={tex} /></RBox>
      {([[-0.6, -0.35, '#f4a6c0'], [0.2, -0.5, '#b9a2e8'], [0.65, 0.15, '#f7b58a']] as const).map(([x, z, c], i) => (
        <RBox key={i} args={[0.55, 0.18, 0.45]} radius={0.08} position={[x, 0.14, z]} rotation-y={i * 0.4} castShadow><meshStandardMaterial color={c} /></RBox>
      ))}
    </group>
  );
}

// Banco de listones: asiento y respaldo inclinado sobre dos laterales con brazos.
function Bench() {
  const d = useMemo(() => {
    const backZ = (y: number) => -0.25 - (y - 0.47) * 0.15 + 0.065; // delante de la pata trasera, que va inclinada
    const slats: Item[] = [
      ...[-0.16, 0, 0.16].map((z, i): Item => ({ p: [0, 0.46, z], s: [1.4, 0.055, 0.13], c: WOODS[i] })),
      ...[0.66, 0.84].map((y, i): Item => ({ p: [0, y, backZ(y)], s: [1.4, 0.12, 0.05], r: [-0.15, 0, 0], c: WOODS[i + 2] })),
    ];
    const frame: Item[] = [-0.62, 0.62].flatMap((x): Item[] => [
      { p: [x, 0.3, 0.17], s: [0.08, 0.6, 0.08] }, // pata delantera, sube hasta el brazo
      { p: [x, 0.47, -0.25], s: [0.08, 0.94, 0.08], r: [-0.15, 0, 0] }, // pata trasera y respaldo
      { p: [x, 0.41, -0.03], s: [0.07, 0.06, 0.48] }, // travesaño bajo el asiento
      { p: [x, 0.63, -0.03], s: [0.1, 0.05, 0.52] }, // brazo
    ]);
    return { slats, frame };
  }, []);
  return (
    <group position={[8.0, 0, -2.6]} rotation-y={0.35}>
      <Scatter geo={BOX} mat={MAT.wood} items={d.slats} />
      <Scatter geo={BOX} mat={MAT.wood} items={d.frame} color={C.woodDark} />
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
  const d = useMemo(() => {
    const r = rng(13), j = (k: number) => (r() - 0.5) * k;
    const planks: Item[] = Array.from({ length: 8 }, (_, i) => ({ p: [j(0.05), -0.32, -0.1 + i * 0.32], s: [1.1 + j(0.08), 0.07, 0.27 + j(0.03)], r: [j(0.02), j(0.05), j(0.02)], c: pick(WOODS, r) }));
    const beams: Item[] = [-0.42, 0.42].map(bx => ({ p: [bx, -0.41, 1.0], s: [0.09, 0.12, 2.5] }));
    const posts: Item[] = [-0.52, 0.52].flatMap(px => [0.3, 2.1].map((pz): Item => ({ p: [px, -1.6, pz], s: [1.1, pz > 1 ? 1.75 : 1.4, 1.1] })));
    return { planks, beams, posts };
  }, []);
  return (
    <group position={[x, 0, z]} rotation-y={dir}>
      <Scatter geo={BOX} mat={MAT.wood} items={d.planks} />
      <Scatter geo={BOX} mat={MAT.wood} items={d.beams} color={C.woodDark} />
      <Scatter geo={POST} mat={MAT.wood} items={d.posts} color={C.woodDark} />
      <group position={[0.52, 0.33, 2.1]}>
        <RBox args={[0.16, 0.22, 0.16]} radius={0.03}><meshStandardMaterial color="#ffd27a" emissive="#ffb347" emissiveIntensity={0.3 + glow * 2} /></RBox>
        <mesh position-y={0.17} rotation-y={Math.PI / 4}><coneGeometry args={[0.15, 0.12, 4]} /><meshStandardMaterial color="#4a3a30" /></mesh>
      </group>
    </group>
  );
}

// ---------- Isla ----------

export default function Island({ waterColor, sky, glow }: { waterColor: string; sky: string; glow: number }) {
  const d = useMemo(() => {
    const r = rng(7);
    // pasaderas hacia la casa: losas irregulares
    const stones: Item[] = Array.from({ length: 8 }, (_, i) => {
      const t = i / 7, x = -0.9 + (-4.4) * t, z = 0.4 + (-1.4) * t;
      return { p: [x + (i % 2 ? 0.09 : -0.09), -0.01, z + (i % 2 ? 0.2 : -0.2)], s: [0.32 + r() * 0.1, 0.06, 0.24 + r() * 0.08], r: r() * 6, v: i };
    });
    const pebbles = pathEdges(37, 0.55, 0.35, [0.98, 1.15]).map(([x, z], i) => rockItem(x, -0.02, z, 0.06 + r() * 0.05, 0.05 + r() * 0.04, i % 4, i * 1.9, 0.1));

    const trees: Item[] = TREES.map(([x, z, s], i) => ({ p: [x, 0, z], s, r: i * 1.7, v: i % 3, c: C.leaf[i % 3] }));
    const trunks = trees.map(t => ({ ...t, c: undefined }));

    // arbustos y sus flores, repartidas por la superficie de las matas mirando hacia fuera
    const bushes: Item[] = [], blossoms: Item[] = [];
    BUSHES.forEach(([x, z, s, flowers], i) => {
      const v = i % 3, ry = i * 2.7;
      bushes.push({ p: [x, 0, z], s, r: ry, v, c: [C.bush, C.leaf[0], C.leaf[2]][i % 3] });
      if (!flowers) return;
      const { clumps } = BUSH_KINDS[v], rot = new THREE.Quaternion().setFromAxisAngle(Y, ry), q = new THREE.Quaternion(), e = new THREE.Euler();
      for (let k = 0; k < 7; k++) {
        const cl = clumps[k % clumps.length], a = k * 2.4 + i, dir = new THREE.Vector3(Math.cos(a) * 0.75, 0.55 + 0.2 * (k % 3), Math.sin(a) * 0.75).normalize();
        const p = new THREE.Vector3(...cl.c).addScaledVector(dir, cl.r * 0.97).applyQuaternion(rot).multiplyScalar(s);
        e.setFromQuaternion(q.setFromUnitVectors(Y, dir).premultiply(rot));
        blossoms.push({ p: [x + p.x, p.y, z + p.z], s: 0.055, r: [e.x, e.y, e.z], c: k % 2 ? '#ff9fc4' : '#ffffff' });
      }
    });

    const rocks: Item[] = [...SHORE_ROCKS, ...FIELD_ROCKS.map(([x, z, hw, h, v], i) => rockItem(x, -0.04, z, hw, h, v, i * 2.3, 0.06))];

    // flores en corros de 3-6 del mismo color (alguna blanca suelta), no confeti por todo el césped
    const flowerColors = ['#ffe066', '#ffffff', '#ff9fc4', '#c9a3ff', '#ffb36b'];
    const flowers = scatterFree(11, 110, (x, z, rr) => {
      const c = pick(flowerColors, rr), n = 3 + Math.floor(rr() * 4), out: Item[] = [];
      for (let k = 0; k < n; k++) {
        const a = rr() * 6.28, dd = 0.06 + rr() * 0.3, px = x + Math.cos(a) * dd, pz = z + Math.sin(a) * dd, s = 0.06 + rr() * 0.035;
        if (isFree(px, pz)) out.push({ p: [px, 1.4 * s, pz], s, r: [(rr() - 0.5) * 0.3, rr() * 6.28, (rr() - 0.5) * 0.3], c: rr() < 0.85 ? c : '#ffffff' });
      }
      return out;
    });

    // hierba: manojos en grupitos con claros entre medias, y por los bordes de los caminos
    const tuft = (x: number, z: number, rr: () => number): Item => ({ p: [x, -0.01, z], s: 0.5 + rr() * 0.35, r: rr() * 6.28, v: Math.floor(rr() * 3), c: pick(GRASS_TONES, rr) });
    const tufts = [
      ...scatterFree(23, 140, (x, z, rr) => {
        const out: Item[] = [], n = 1 + Math.floor(rr() * 4);
        for (let k = 0; k < n; k++) {
          const a = rr() * 6.28, dd = rr() * 0.3, px = x + Math.cos(a) * dd, pz = z + Math.sin(a) * dd;
          if (isFree(px, pz) && offNav(px, pz)) out.push(tuft(px, pz, rr));
        }
        return out;
      }),
      ...pathEdges(31, 0.42, 0.5, [0.92, 1.12]).filter(([x, z]) => offNav(x, z)).map(([x, z]) => tuft(x, z, r)),
      ...FIELD_ROCKS.flatMap(([x, z, hw], i) => [0, 1].map(k => tuft(x + Math.cos(i + k * 2.5) * hw * 1.05, z + Math.sin(i + k * 2.5) * hw * 0.9, r))),
      // alrededor del estanque, sin tapar los extremos del puente
      ...pondOutline(POND_GROW + 0.22, 60).filter(p => r() < 0.4 && offNav(p.x, -p.y) && [[6.13, 4.64], [4.97, 1.66]].every(([bx, bz]) => Math.hypot(p.x - bx, -p.y - bz) > 0.8))
        .map(p => tuft(p.x, -p.y, r)),
    ];

    // estanque: nenúfares con muesca, lotos encima y eneas en la orilla (pie a la altura del agua)
    const lilies: Item[] = ([[3.0, 3.0], [4.6, 3.9], [3.6, 4.2], [6.9, 2.7], [2.6, 3.8]] as const).map(([x, z], i) => ({ p: [x, POND_Y + 0.004, z], s: 0.27 - i * 0.02, r: i * 2.1 + 0.5, c: ['#5a9e3a', '#68ab44', '#4f9134'][i % 3] }));
    const lotus: Item[] = [{ p: [4.6, POND_Y + 0.035, 3.9], s: 0.085, r: 0.3, c: '#ff9fc4' }, { p: [3.0, POND_Y + 0.035, 3.0], s: 0.075, r: 1.1, c: '#ffffff' }];
    const reeds: Item[] = [[2.0, 4.3], [2.2, 4.6], [1.8, 4.0], [7.7, 3.4], [7.9, 3.1], [5.2, 4.6]].map(([x, z], i) => ({ p: [x, POND_Y, z], s: 0.85 + (i % 3) * 0.15, r: i * 2.2 }));

    const gardenFence = fence([[-8.9, 2.95], [-5.85, 2.95], [-5.85, 0.35]], 3);
    const pathFence = fence([[-1.5, 6.1], [-0.4, 6.4]], 4);
    // huerto: tierra con caballones, borde de tablas y brotes en hilera
    const mounds: Item[] = [0, 1, 2].map(row => ({ p: [-7.4, 0.06, 0.95 + row * 0.6], s: [0.46, 0.22, 0.5], c: '#8f5f3d' }));
    const bedBoards: Item[] = [
      { p: [-7.4, 0.07, 0.6], s: [2.68, 0.14, 0.08] }, { p: [-7.4, 0.07, 2.6], s: [2.68, 0.14, 0.08] },
      { p: [-8.7, 0.07, 1.6], s: [0.08, 0.14, 2.0] }, { p: [-6.1, 0.07, 1.6], s: [0.08, 0.14, 2.0] },
    ];
    const sprouts: Item[] = [];
    for (let row = 0; row < 3; row++) for (let k = 0; k < 5; k++) sprouts.push({ p: [-8.4 + k * 0.5 + (r() - 0.5) * 0.08, 0.15, 0.95 + row * 0.6], s: 0.85 + r() * 0.35, r: r() * 6.28, c: k % 2 ? '#5fa83a' : '#7cc24e' });

    const white = (l: Item[]) => l.map(it => ({ ...it, c: undefined })); // botones y tallos: su propio color por vértice
    return {
      stones, pebbles, trees, trunks, bushes, blossoms, blossomCores: white(blossoms), rocks, flowers, flowerCores: white(flowers), tufts,
      lilies, lotus, lotusCores: lotus.map(l => ({ ...l, p: [l.p[0], l.p[1] + 0.01, l.p[2]] as V3, s: 0.05, c: undefined })), reeds,
      posts: [...gardenFence.posts, ...pathFence.posts], rails: [...gardenFence.rails, ...pathFence.rails], mounds, bedBoards, sprouts,
    };
  }, []);

  return (
    <group>
      <Water color={waterColor} sky={sky} />
      <Ground />
      <PathRibbons />
      <Variants geos={FLAGS} mat={MAT.rock} items={d.stones} color={C.stone} shadow={false} />
      <Variants geos={ROCKS_LO} mat={MAT.rock} items={d.pebbles} color={C.stone} shadow={false} />
      <Variants geos={TRUNKS} mat={MAT.bark} items={d.trunks} color={C.trunk} />
      <Variants geos={CANOPIES} mat={MAT.foliage} items={d.trees} />
      <Variants geos={BUSH_GEOS} mat={MAT.foliage} items={d.bushes} />
      <Scatter geo={FLOWER} mat={MAT.vcol} items={d.blossoms} shadow={false} />
      <Scatter geo={BLOSSOM_CORE} mat={MAT.vcol} items={d.blossomCores} shadow={false} />
      <Variants geos={ROCKS} mat={MAT.rock} items={d.rocks} color={C.rock} />
      <Scatter geo={FLOWER} mat={MAT.vcol} items={d.flowers} shadow={false} />
      <Scatter geo={FLOWER_CORE} mat={MAT.vcol} items={d.flowerCores} shadow={false} />
      <Variants geos={TUFTS} mat={MAT.vcol} items={d.tufts} shadow={false} />
      <Scatter geo={LILY_PAD} mat={MAT.vcol} items={d.lilies} shadow={false} />
      <Scatter geo={LOTUS} mat={MAT.vcol} items={d.lotus} shadow={false} />
      <Scatter geo={BLOSSOM_CORE} mat={MAT.vcol} items={d.lotusCores} shadow={false} />
      <Scatter geo={CATTAIL} mat={MAT.vcol} items={d.reeds} />
      <Scatter geo={FENCE_POST} mat={MAT.wood} items={d.posts} />
      <Scatter geo={BOX} mat={MAT.wood} items={d.rails} />
      {/* huerto */}
      <Scatter geo={BOX} items={[{ p: [-7.4, 0.02, 1.6], s: [2.6, 0.1, 2.0] }]} color="#7d5234" shadow={false} />
      <Scatter geo={MOUND} items={d.mounds} shadow={false} />
      <Scatter geo={BOX} mat={MAT.wood} items={d.bedBoards} color={C.woodDark} />
      <Scatter geo={SPROUT} mat={MAT.vcol} items={d.sprouts} />
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
