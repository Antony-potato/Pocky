'use client';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { rng, uTime, shaded, VARY, smoothSlab } from './materials';
import {
  ROCKS, ROCKS_LO, ROCK_HW, FLAGS, COBBLES, TREE_KINDS, BUSH_KINDS, IVY, TUFTS, CLOVER, SPROUT, FLOWERS, FLOWER_CORE, BLOSSOM_CORE, LOTUS, LILY_PAD,
  CATTAIL, LOG, FLAME, SHINGLE, CUSHION, BOWL, post,
} from './shapes';
import { NODES, EDGES } from './nav';

// Isla generada por código (sin modelos externos). Mundo: x derecha, z hacia la cámara (sur), y arriba.
// La hierba está en y = 0. Las posiciones de los sitios coinciden con los nodos de nav.ts.
// Los modelos (rocas, árboles, hierba, flores...) están en shapes.ts; aquí se colocan.

export const RX = 9.6;
export const RZ = 7.4;
const edgeR = (a: number) => 1 + 0.05 * Math.sin(3 * a + 1) + 0.03 * Math.sin(5 * a + 2);
const edgeAt = (a: number, k = 1): [number, number] => [Math.cos(a) * RX * edgeR(a) * k, Math.sin(a) * RZ * edgeR(a) * k];

// Paleta alegre pero suave (tipo maqueta): saturación media, sin el lima ni el cian chillones del principio.
const C = {
  grass: '#a3d466', dirt: '#b8805a', path: '#f0c88c', stone: '#e2cfb1', rock: '#ddd0bf',
  trunk: '#9c6142', wood: '#b4743f', woodDark: '#935a2e', leaf: ['#88c552', '#9ccf5c', '#7cbc4c'],
  bush: ['#56ad52', '#66b95c', '#4aa04e'], rim: '#dccfa8',
};
const WOODS = ['#a86f42', '#b57a4a', '#9c6640', '#b0784a', '#a26a3f'];
const DARK_WOODS = ['#8b5a33', '#7f5230', '#93603a'];
const GRASS_TONES = ['#84c64e', '#74b844', '#93d05a'];
const pick = <T,>(a: T[], r: () => number) => a[Math.floor(r() * a.length)];

const SPHERE = new THREE.SphereGeometry(1, 16, 12);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const BOX = new RoundedBoxGeometry(1, 1, 1, 2, 0.14); // cantos redondeados; con escala no uniforme el bisel se adapta a cada pieza
const MOUND = new THREE.CapsuleGeometry(0.5, 4, 4, 12).rotateZ(Math.PI / 2); // caballón del huerto
const FENCE_POST = post(0.14, 0.62);
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
  foliage: shaded({ roughness: 0.9, vertexColors: true }, {
    key: 'foliage',
    head: 'float leafBumps(vec3 p) { p *= 6.; return vnoise(p.xy + p.z * .7) * .5 + vnoise(p.zy * 1.3 + p.x * .6) * .5; }',
    color: 'diffuseColor.rgb *= (.9 + .2 * vnoise(vW.xz * .9 + vW.y * 1.4)) * (.86 + .2 * leafBumps(vL));',
    normal: `float h = leafBumps(vL) * .1;
      vec3 sp = -vViewPosition, dx = dFdx(sp), dy = dFdy(sp), r1 = cross(dy, normal), r2 = cross(normal, dx);
      float det = dot(dx, r1);
      normal = normalize(abs(det) * normal - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2));`,
  }),
  bark: shaded({ roughness: 0.95, vertexColors: true }, { key: 'bark', color: 'diffuseColor.rgb *= .8 + .28 * vnoise(vec2((vL.x - vL.z) * 9., vL.y * 1.4));' }),
  // Rocas (altura 1, base en 0): el tono de cada cara y los cantos vienen en el color por vértice; aquí pie
  // oscuro, parte de arriba clara, vetas suaves y tono algo cálido o frío por zonas.
  rock: shaded({ roughness: 0.9, vertexColors: true }, {
    key: 'rock',
    color: /* glsl */ `
      float n = vnoise(vL.xz * 3. + vL.y * 4.) * .6 + vnoise(vW.xz * 9. + vW.y * 7.) * .4;
      // pie más oscuro (contacto con la hierba); en las rocas de la orilla el pie está bajo el agua y lo que asoma va
      // claro, con solo una banda mojada justo encima del agua
      diffuseColor.rgb *= mix(mix(.68, 1.07, smoothstep(0., .45, vL.y)), 1.03, step(vW.y, -.35) * .7) * (.87 + .22 * n);
      diffuseColor.rgb *= mix(.82, 1., smoothstep(-1.5, -1.38, vW.y));
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
const PLAZAS: V3[] = [[0.35, -1.2, 1.15]]; // explanada en el cruce: x, z, radio
PATH_PTS.push(...PLAZAS.map(([x, z, w]) => ({ x, z, w })));

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
// Variantes: 0 mediana asimétrica, 1 achatada, 2 grande de muchas caras, 3 alargada, 4 grupito de piedras.
const SHORE_ROCKS = ([[200, 1.1, 0.2, 2], [150, 0.9, -0.05, 0], [25, 1.2, 0.3, 2], [340, 0.85, -0.1, 3], [75, 0.9, -0.05, 0], [112, 0.75, -0.4, 4], [255, 0.8, -0.2, 3]] as const).map(([deg, hw, top, v]) => {
  const [x, z] = edgeAt((deg * Math.PI) / 180, 1.04);
  return { ...rockItem(x, -1.65, z, hw, top + 1.65, v, deg, 0.08), hw };
});
// Rocas sueltas por el césped, algo hundidas: [x, z, semiancho, alto, variante]. Una grande con otra pequeña al lado.
const FIELD_ROCKS: [number, number, number, number, number][] = [[-7.2, 4.4, 0.52, 0.62, 2], [-7.85, 3.85, 0.38, 0.28, 1], [1.2, 5.7, 0.48, 0.5, 0], [1.85, 5.4, 0.34, 0.24, 3], [-4.2, -4.7, 0.42, 0.36, 4]];

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

// Máscara de los caminos para el shader de la hierba (rojo: 1 dentro, 0.5 en el borde, 0 fuera, con un degradado
// de ±PATH_FADE alrededor del borde). Unión de discos con degradado radial a lo largo de cada curva: componer
// con 'lighten' se queda con el máximo, que equivale a la distancia al camino más cercano.
const PATH_FADE = 0.35, PATH_TEX = { value: null as THREE.Texture | null };
function pathMask() {
  const W = 512, H = Math.round((512 * RZ) / RX), k = W / (2 * RX), cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighten';
  const disc = (x: number, z: number, w: number) => {
    const R = (w + PATH_FADE) * k, cx = (x + RX) * k, cy = (z + RZ) * k, gr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    gr.addColorStop((w - PATH_FADE) / (w + PATH_FADE), '#fff'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  };
  PATH_CURVES.forEach(({ curve, w }, j) => {
    const n = Math.ceil(curve.getLength() / 0.06);
    for (let i = 0; i <= n; i++) { const p = curve.getPointAt(i / n); disc(p.x, p.z, pathWidth(i / n, w, j)); }
  });
  const [ex, ez] = PATHS[1].pts.at(-1)!;
  disc(ex, ez, PATHS[1].w * 1.05); // placita al final del camino corto
  for (const [x, z, w] of PLAZAS) disc(x, z, w);
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

// Color del césped compartido por el suelo y las briznas del pasto corto (cada brizna sale del tono del suelo que
// tiene debajo): manchas muy suaves a dos escalas (la meseta tiene que leerse plana) y oclusión de contacto bajo
// árboles, arbustos, rocas y casa.
const LAWN = /* glsl */ `
const vec3 OCC[${OCCLUDERS.length}] = vec3[](${OCCLUDERS.map(o => `vec3(${o.map(f).join(', ')})`).join(', ')});
vec3 lawnTint(vec2 p) {
  float n = vnoise(p * .28) * .6 + vnoise(p * 1.1) * .4;
  return mix(vec3(.94, .98, .95), vec3(1.03, 1.02, .95), n);
}
float lawnAO(vec2 p) {
  float ao = 1.;
  for (int i = 0; i < ${OCCLUDERS.length}; i++) {
    vec2 o = (p - OCC[i].xy) / OCC[i].z;
    ao *= 1. - .3 * (1. - smoothstep(.02, 1., dot(o, o)));
  }
  vec2 q = abs(p - vec2(${f(HOUSE.x)}, ${f(HOUSE.z)})) - vec2(1.58, 1.38);
  return ao * (1. - .4 * (1. - smoothstep(0., .9, length(max(q, 0.)) + min(max(q.x, q.y), 0.))));
}`;

const GRASS = shaded({ color: C.grass, roughness: 0.95 }, {
  key: 'grass',
  uniforms: { uPath: PATH_TEX },
  head: `uniform sampler2D uPath;\n${LAWN}`,
  color: /* glsl */ `
    vec2 p = vW.xz;
    diffuseColor.rgb *= lawnTint(p);
    // Camino: la máscara con el borde movido por ruido (borde mordido, lenguas de hierba que entran en la
    // tierra). Tierra con manchas grandes de tono, granos y el borde algo más oscuro (pisado).
    float pm = texture2D(uPath, (p + vec2(${f(RX)}, ${f(RZ)})) / vec2(${f(2 * RX)}, ${f(2 * RZ)})).r;
    float pe = pm + (vnoise(p * 1.4) * .75 + vnoise(p * 4.) * .25 - .5) * .26;
    vec2 pr = mat2(.8, -.6, .6, .8) * p; // girado: las manchas del ruido no se alinean con los ejes
    vec3 dirt = vec3(${lin(C.path)}) * (.91 + .12 * vnoise(pr * 1.6)) * (1. - .07 * smoothstep(.6, .85, vnoise(pr * 6.3) * .6 + vnoise(p * 11.) * .4));
    dirt *= mix(vec3(1.04, 1.01, .94), vec3(.97, .99, 1.02), vnoise(p * .45 + 9.)) * mix(.84, 1.04, smoothstep(.5, .78, pe));
    diffuseColor.rgb = mix(diffuseColor.rgb, dirt, smoothstep(.47, .53, pe) * smoothstep(-.17, -.11, vW.y)); // acaba al empezar el borde de la isla
    // labio del borde de la isla: más oscuro según baja (además la pendiente oscurece la luz, abajo)
    diffuseColor.rgb *= mix(.82, 1., smoothstep(-.75, -.04, vW.y));
    // orilla del estanque: arena, más oscura (mojada) al bajar hacia el agua
    vec3 sand = vec3(${lin(C.rim)}) * mix(.68, 1., smoothstep(${f(POND_Y - 0.02)}, -.01, vW.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, sand, 1. - smoothstep(1.0, 1.1 + .05 * vnoise(p * 5.), ${pondField(POND_GROW)}));
    diffuseColor.rgb *= mix(1., lawnAO(p), step(-.08, vW.y));`,
  // Lo que empieza a caer pierde luz desde el primer centímetro: si no, la cara del borde que mira al sol queda más
  // clara que la meseta y se lee un reborde levantado con el centro hundido.
  light: 'outgoingLight *= mix(.6, 1., smoothstep(.55, .985, inverseTransformDirection(normal, viewMatrix).y));',
});

const DIRT = shaded({ color: C.dirt, roughness: 1 }, {
  key: 'dirt',
  color: /* glsl */ `
    // estratos ondulados, más oscuro hacia abajo y banda húmeda justo encima del agua
    float s = sin(vW.y * 8. + vnoise(vW.xz * .9) * 4.);
    diffuseColor.rgb *= (.9 + .1 * smoothstep(-.3, .3, s)) * (.93 + .12 * vnoise(vW.xz * 4. + vW.y * 5.));
    diffuseColor.rgb *= mix(.6, 1.04, smoothstep(-2.4, -.5, vW.y)) * mix(.78, 1., smoothstep(-1.52, -1.32, vW.y));`,
  light: 'outgoingLight = mix(outgoingLight, diffuseColor.rgb * .55, .4);',
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

// Repisa de arena al pie del acantilado: ancho por ángulo (el mismo en JS y en el shader del mar) y la fracción
// de ese ancho donde la arena se mete bajo el agua (línea de orilla).
const beachW = (a: number) => 0.34 + 0.1 * Math.sin(4 * a + 2) + 0.06 * Math.sin(9 * a + 1);
const BEACH_WL = 0.64, SAND = '#e0cfac';

const SEA = waterMat('sea', /* glsl */ `
  const vec3 ROCKS[${SHORE_ROCKS.length}] = vec3[](${SHORE_ROCKS.map(({ p: [x, , z], hw }) => `vec3(${f(x)}, ${f(z)}, ${f(hw * 0.95)})`).join(', ')});
  // distancia (radial) al pie del acantilado; bw = ancho de la repisa de arena en ese ángulo
  float islandD(vec2 p, out float bw) {
    float a = atan(p.y / ${f(RZ)}, p.x / ${f(RX)});
    float e = 1. + .05 * sin(3. * a + 1.) + .03 * sin(5. * a + 2.);
    bw = .34 + .1 * sin(4. * a + 2.) + .06 * sin(9. * a + 1.);
    return length(p) - length(vec2(cos(a) * ${f(RX)}, sin(a) * ${f(RZ)})) * e * .985 - .3;
  }
  float rockD(vec2 p) {
    float d = 1e3;
    for (int i = 0; i < ${SHORE_ROCKS.length}; i++) d = min(d, length(p - ROCKS[i].xy) - ROCKS[i].z);
    return d;
  }`, /* glsl */ `
  // Orilla suave como en la referencia: el agua junto a la isla es casi la misma que la de lejos, la arena se ve
  // bajo el agua poco honda y se va perdiendo, y la espuma es una línea fina azul pálida (no un anillo blanco).
  float bw, di = islandD(p, bw), wl = ${f(BEACH_WL)} * bw, d = min(di - wl, rockD(p)), sh = exp(-max(d, 0.) * .45);
  vec3 col = mix(uDeep, uShallow, sh) * (.95 + .1 * vnoise(p * .06 + t * .02));
  float c = 1. - smoothstep(0., .28, cells(p * .42 + vec2(t * .02, 0.), t * .4));
  col = mix(col, uShallow * 1.2, c * (.06 + .14 * sh));
  if (d < 2.) { // lejos de la orilla no hay arena ni espuma: se ahorra el ruido
    float under = 1. - smoothstep(wl, bw + .5 + .15 * vnoise(p * 1.3), di);
    col = mix(col, vec3(${lin(SAND)}) * .8 * mix(uShallow, vec3(1.), .5), under * .55);
    float foam = 1. - smoothstep(0., .1, d + .04 * vnoise(p * 3. + t * .6));
    float w = fract(t * .08);
    foam = max(foam, (1. - smoothstep(0., .07, abs(d - .1 - w * 1.2 + .12 * vnoise(p * 1.5)))) * (1. - w) * .25 * smoothstep(.3, .6, vnoise(p * .9 + 3.)));
    col = mix(col, vec3(.84, .93, .96), clamp(foam, 0., 1.) * .6);
  }
  diffuseColor.rgb = col;`,
{ wave: 1, refl: 0.16, spark: 2.2, dens: 0.04 });

// Arena de la repisa: seca arriba, más oscura y fría donde la moja el agua, y algo sombreada contra el acantilado.
const BEACH = shaded({ color: SAND, roughness: 1 }, {
  key: 'beach',
  color: `diffuseColor.rgb *= (.94 + .1 * vnoise(vW.xz * 4.)) * mix(vec3(1.), vec3(.74, .76, .8), 1. - smoothstep(-1.5, -1.455, vW.y))
    * mix(.82, 1., 1. - smoothstep(-1.445, -1.42, vW.y));`,
});

const POND = waterMat('pond', /* glsl */ `
  float pondDist(vec2 p) { return (1. - ${pondField(0)}) * 1.2; }`, /* glsl */ `
  float d = pondDist(p);
  vec3 col = mix(uDeep * .8, uShallow, 1. - smoothstep(0., 1.1, d)); // más hondo (oscuro) en el centro
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

// Densidad de la vegetación decorativa: alta junto a pies de árbol, rocas, arbustos, vallas y casa, y en unas
// pocas manchas de pradera (ruido de baja frecuencia); casi nula en el resto, que queda como césped limpio.
const h2 = (i: number, j: number) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise2(x: number, z: number) {
  const i = Math.floor(x), j = Math.floor(z), u = (x - i) ** 2 * (3 - 2 * (x - i)), v = (z - j) ** 2 * (3 - 2 * (z - j));
  return (h2(i, j) * (1 - u) + h2(i + 1, j) * u) * (1 - v) + (h2(i, j + 1) * (1 - u) + h2(i + 1, j + 1) * u) * v;
}
const FENCES: [number, number][][] = [[[-8.9, 2.95], [-5.85, 2.95], [-5.85, 0.35]], [[-1.5, 6.1], [-0.4, 6.4]]];
const ANCHORS: V3[] = [ // x, z, radio de influencia
  ...TREES.map(([x, z, s]): V3 => [x, z, 1.7 * s]),
  ...FIELD_ROCKS.map(([x, z, hw]): V3 => [x, z, hw * 2.8]),
  ...BUSHES.map(([x, z, s]): V3 => [x, z, 1.4 * s]),
  ...FENCES.flatMap(pts => pts.slice(1).flatMap(([x1, z1], i) => {
    const [x0, z0] = pts[i], n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5);
    return Array.from({ length: n + 1 }, (_, k): V3 => [x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n, 0.75]);
  })),
  ...[-1, 0, 1].flatMap(k => [[HOUSE.x + k * 1.6, HOUSE.z + 1.75, 0.8], [HOUSE.x - 2.0, HOUSE.z + k * 1.3, 0.8], [HOUSE.x + 2.0, HOUSE.z + k * 1.3, 0.8]] as V3[]),
];
const sst = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const decor = (x: number, z: number) => Math.max(
  ...ANCHORS.map(([ax, az, r]) => 1 - sst(0.3 * r, r, Math.hypot(x - ax, z - az))),
  0.75 * sst(0.6, 0.78, noise2(x * 0.32 + 3.1, z * 0.32 + 7.7)),
  0.03,
);
// Grupos colocados según `decor`: cada punto aceptado genera un grupo con make().
function scatterDecor(seed: number, groups: number, make: (x: number, z: number, d: number, r: () => number) => Item[]) {
  const r = rng(seed), out: Item[] = [];
  for (let tries = 0, n = 0; n < groups && tries < groups * 60; tries++) {
    const x = (r() * 2 - 1) * RX, z = (r() * 2 - 1) * RZ, d = decor(x, z);
    if (isFree(x, z) && offNav(x, z) && r() < d) { out.push(...make(x, z, d, r)); n++; }
  }
  return out;
}

// Valla: postes con remate, algo torcidos y de alturas distintas; dos tablas clavadas por una cara de los postes
// que sobresalen un poco en los extremos.
function fence(points: [number, number][], seed: number) {
  const r = rng(seed), j = (k: number) => (r() - 0.5) * k, posts: Item[] = [], rails: Item[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), n = Math.max(1, Math.round(len / 0.75)), ry = Math.atan2(-dz, dx);
    const nx = -dz / len, nz = dx / len, ux = dx / len, uz = dz / len, e0 = i === 0 ? 0.12 : 0.07, e1 = i === points.length - 2 ? 0.12 : 0.07;
    for (let k = 0; k <= n; k++) if (k < n || i === points.length - 2) {
      posts.push({ p: [x0 + (dx * k) / n, -0.02, z0 + (dz * k) / n], s: [1, 0.94 + r() * 0.12, 1], r: [j(0.06), ry + j(0.2), j(0.06)], c: pick(DARK_WOODS, r) });
    }
    for (const y of [0.27, 0.5]) {
      const off = 0.09, mid = (e1 - e0) / 2;
      rails.push({ p: [(x0 + x1) / 2 + nx * off + ux * mid, y + j(0.03), (z0 + z1) / 2 + nz * off + uz * mid], s: [len + e0 + e1 + j(0.04), 0.1, 0.035], r: [j(0.04), ry, j(0.025)], c: pick(WOODS, r) });
    }
  }
  return { posts, rails };
}

// ---------- Piezas ----------

function Ground() {
  const geos = useMemo(() => {
    PATH_TEX.value ??= pathMask();
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
    // Repisa de arena: tres hileras alrededor del pie del acantilado (dentro de la pared, línea del agua, bajo el
    // agua). Lo que queda por debajo de y = -1.5 lo tapa el mar, que pinta la arena sumergida.
    const n = 160, rows: [number, number][] = [[-0.06, -1.42], [0.55, -1.48], [1, -1.6]], P: number[] = [], I: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, [ex, ez] = edgeAt(a, 0.985), L = Math.hypot(ex, ez), bw = beachW(a);
      for (const [k, y] of rows) { const r = L + 0.3 + (k < 0 ? k : k * bw); P.push((ex / L) * r, y, (ez / L) * r); }
      if (i < n) for (let j = 0; j < 2; j++) { const a0 = i * 3 + j, b0 = a0 + 3; I.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); }
    }
    const beach = new THREE.BufferGeometry();
    beach.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    beach.setIndex(I);
    beach.computeVertexNormals();
    return { grass: slab(grass, 0.3, 0.3, 0), dirt: slab(shape(0.985), 1.7, 0.3, -0.42), pond, beach };
  }, []);
  return (
    <>
      <mesh geometry={geos.grass} material={GRASS} receiveShadow />
      <mesh geometry={geos.dirt} material={DIRT} receiveShadow castShadow />
      <mesh geometry={geos.beach} material={BEACH} receiveShadow />
      <mesh geometry={geos.pond} material={POND.mat} position-y={POND_Y} receiveShadow />
    </>
  );
}

// Mar alrededor de la isla. La espuma de la orilla la pinta el propio shader (ver SEA).
function Water({ color, sky }: { color: string; sky: string }) {
  useEffect(() => {
    const deep = new THREE.Color(color);
    SEA.uniforms.uDeep.value.copy(deep);
    SEA.uniforms.uShallow.value.copy(deep).offsetHSL(-0.012, -0.01, 0.04); // apenas más claro junto a la orilla
    POND.uniforms.uDeep.value.copy(deep).offsetHSL(-0.03, 0.02, 0.03);
    POND.uniforms.uShallow.value.copy(deep).offsetHSL(-0.06, 0.06, 0.17);
    for (const u of [SEA.uniforms, POND.uniforms]) u.uSky.value.set(sky);
  }, [color, sky]);
  useFrame(({ clock }) => { uTime.value = clock.elapsedTime; });
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -1.5, 0]} material={SEA.mat}>
      <planeGeometry args={[160, 160]} />
    </mesh>
  );
}

// ---------- Pasto corto ----------

// Por toda la isla: manojos de tres briznas (un triángulo cada una) en una sola draw call con instancing. La
// posición, el giro y la altura van en un atributo por manojo; el vertex shader coloca la brizna, mece la punta y
// toma el color del césped que tiene debajo (lawnTint/lawnAO, igual que el suelo), así que no se ve una alfombra
// pegada encima. Normal siempre hacia arriba (se ilumina como el suelo, por las dos caras). Recibe sombras pero no
// las proyecta. Mitad de densidad en dispositivos modestos.
// ponytail: densidad por número de núcleos; si hiciera falta, medir FPS y ajustar en caliente.
const CARPET_CELL = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4 ? 0.19 : 0.13;
const CARPET = shaded({ color: C.grass, roughness: 1, side: THREE.DoubleSide }, {
  key: 'carpet',
  uniforms: { uTime },
  vhead: `attribute vec4 aOff;\nuniform float uTime;\nvarying vec3 vTint;\nvarying float vTip;\n${LAWN}`,
  vertex: `
    float cs = cos(aOff.z), sn = sin(aOff.z);
    vTip = position.y;
    transformed = vec3(cs * position.x - sn * position.z, position.y, sn * position.x + cs * position.z) * aOff.w;
    transformed.xz += vTip * aOff.w * sin(uTime * 1.6 + aOff.x * .8 + aOff.y * .5) * vec2(.12, .08) + aOff.xy;
    vTint = lawnTint(aOff.xy) * lawnAO(aOff.xy) * (.93 + .14 * fract(sin(dot(aOff.xy, vec2(12.99, 78.23))) * 43758.5));`,
  head: 'varying vec3 vTint;\nvarying float vTip;',
  color: 'diffuseColor.rgb *= vTint * mix(.9, 1.2, vTip);',
  normal: 'normal = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz);',
});
// Manojo de altura 1: tres briznas inclinadas hacia fuera en direcciones distintas.
const BLADES = (() => {
  const P: number[] = [];
  [[0.4, 1], [2.5, 0.8], [4.6, 0.9]].forEach(([a, h], i) => {
    const c = Math.cos(a), s = Math.sin(a), w = 0.14, lean = 0.28 + 0.08 * i, bx = c * 0.15, bz = s * 0.15;
    P.push(bx - s * w, 0, bz + c * w, bx + s * w, 0, bz - c * w, c * (0.15 + lean * h), h, s * (0.15 + lean * h));
  });
  return P;
})();

function GrassCarpet({ avoid }: { avoid: V3[] }) {
  const geo = useMemo(() => {
    const tex = (PATH_TEX.value ??= pathMask()), cv = tex.image as HTMLCanvasElement, k = cv.width / (2 * RX);
    const mask = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    const holes: V3[] = [...avoid, [FIRE.x, FIRE.z, 0.72], [BED.x, BED.z, 0.66], [8.3, 1.0, 0.36], [8.9, 1.45, 0.34],
      ...TREES.map(([x, z, s]): V3 => [x, z, 0.28 * s]), ...FIELD_ROCKS.map(([x, z, hw]): V3 => [x, z, hw * 0.85])];
    const rects = [[-7.2, -4.5, -3.8, -1.15], [-8.8, 0.5, -6.0, 2.7], [2.35, -4.15, 4.45, -2.45]];
    const free = (x: number, z: number) => {
      const a = Math.atan2(z / RZ, x / RX);
      if (Math.hypot(x / RX, z / RZ) > edgeR(a) * 0.985) return false; // solo la meseta, no el borde que cae
      if (mask[(Math.floor((z + RZ) * k) * cv.width + Math.floor((x + RX) * k)) * 4] > 0.4 * 255) return false; // camino
      if (PONDS.some(p => inEllipse(x, z, p.x, p.z, p.rx + 0.32, p.rz + 0.32))) return false;
      return !rects.some(r => inRect(x, z, r)) && !holes.some(([hx, hz, r]) => Math.hypot(x - hx, z - hz) < r);
    };
    const r = rng(99), off: number[] = [];
    for (let x = -RX; x < RX; x += CARPET_CELL) for (let z = -RZ; z < RZ; z += CARPET_CELL) {
      const px = x + r() * CARPET_CELL, pz = z + r() * CARPET_CELL;
      if (free(px, pz)) off.push(px, pz, r() * 6.28, 0.07 + r() * 0.06);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(BLADES, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(BLADES.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(off), 4));
    g.instanceCount = off.length / 4;
    return g;
  }, [avoid]);
  return <mesh geometry={geo} material={CARPET} receiveShadow frustumCulled={false} />;
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
          c: pick(['#e6b878', '#dcab6a', '#ecc285', '#d8a462', '#e2b373'], r),
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
    // hastiales con entramado: pendolón y dos tornapuntas
    for (const x of [-1, 1]) {
      wood.push({ p: [x * 1.53, 2.95, 0], s: [0.08, 1.25, 0.1], c: C.woodDark });
      for (const sz of [-1, 1]) wood.push({ p: [x * 1.53, 2.635, sz * 0.6], s: [0.07, 1.36, 0.09], r: [-sz * 1.087, 0, 0], c: C.woodDark });
    }
    // ventanas (coordenadas de la ventana, z hacia fuera): marco de cuatro piezas con el cristal hundido, cruz,
    // alféizar con dos ménsulas debajo y dintel
    const glass: V3[] = [];
    for (const [ox, oz, ry] of [[-0.85, 1.3, 0], [-1.5, 0, -Math.PI / 2]]) {
      const c = Math.cos(ry), s = Math.sin(ry), w = (lx: number, ly: number, lz: number): V3 => [ox + lx * c + lz * s, 1.35 + ly, oz - lx * s + lz * c];
      const piece = (lx: number, ly: number, lz: number, sc: V3, col = C.woodDark): Item => ({ p: w(lx, ly, lz), s: sc, r: ry, c: col });
      wood.push(
        piece(0, 0.36, 0, [0.82, 0.1, 0.11]), piece(0, -0.36, 0, [0.82, 0.1, 0.11]), piece(-0.36, 0, 0, [0.1, 0.62, 0.11]), piece(0.36, 0, 0, [0.1, 0.62, 0.11]),
        piece(0, 0, 0, [0.62, 0.045, 0.04]), piece(0, 0, 0, [0.045, 0.62, 0.04]),
        piece(0, -0.45, 0.07, [0.98, 0.075, 0.22], C.wood), piece(-0.3, -0.53, 0.05, [0.07, 0.1, 0.1]), piece(0.3, -0.53, 0.05, [0.07, 0.1, 0.1]),
        piece(0, 0.46, 0.04, [0.94, 0.09, 0.13], C.wood),
      );
      glass.push(w(0, 0, -0.03));
    }
    // bisagras de la puerta y brazo del farol (hierro)
    for (const y of [0.58, 1.14]) wood.push({ p: [0.19, y, 1.38], s: [0.44, 0.045, 0.02], c: '#3d342e' });
    wood.push({ p: [1.05, 1.83, 1.37], s: [0.04, 0.04, 0.16], c: '#4a3a30' });

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
      <mesh position={[0, ROOF.y + ROOF.rise + 0.06, 0]} rotation-z={Math.PI / 2} castShadow><capsuleGeometry args={[0.15, 2 * ROOF.half - 0.1, 4, 12]} /><meshStandardMaterial color="#c4904e" roughness={0.95} /></mesh>
      <RBox args={[0.5, 1.4, 0.5]} radius={0.05} position={[-0.8, 3.2, -0.5]} material={HOUSE_MAT.chimney} castShadow />
      <RBox args={[0.62, 0.14, 0.62]} radius={0.04} position={[-0.8, 3.36, -0.5]} material={HOUSE_MAT.chimney} castShadow />
      <RBox args={[0.66, 0.14, 0.66]} radius={0.04} position={[-0.8, 3.92, -0.5]} material={HOUSE_MAT.chimney} castShadow />
      {/* cañón de barro con la boca oscura */}
      <mesh position={[-0.8, 4.11, -0.5]} scale={[0.11, 0.24, 0.11]} geometry={CYL} castShadow><meshStandardMaterial color="#b5643c" roughness={0.9} /></mesh>
      <mesh position={[-0.8, 4.232, -0.5]} scale={[0.08, 0.01, 0.08]} geometry={CYL}><meshBasicMaterial color="#2b211c" /></mesh>
      <group ref={smoke} position={[-0.8, 4.28, -0.5]}>
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
      {/* botiquín entre la puerta y la esquina, bajo el farol: Pocky viene aquí a por su medicina (POI 'heal') */}
      <group position={[1.12, 0.8, 1.38]}>
        <RBox args={[0.42, 0.5, 0.16]} radius={0.04} castShadow><meshStandardMaterial color="#f6f2ea" roughness={0.6} /></RBox>
        <mesh position-z={0.082} scale={[0.24, 0.075, 0.012]} geometry={BOX}><meshStandardMaterial color="#e5484d" roughness={0.5} /></mesh>
        <mesh position-z={0.082} scale={[0.075, 0.24, 0.012]} geometry={BOX}><meshStandardMaterial color="#e5484d" roughness={0.5} /></mesh>
        <mesh position={[0.17, 0, 0.085]} scale={0.022} geometry={SPHERE}><meshStandardMaterial color="#c9c2b6" /></mesh>
        <mesh position-y={0.28} scale={[0.48, 0.05, 0.2]} geometry={BOX} castShadow><meshStandardMaterial color={C.wood} roughness={0.85} /></mesh>
      </group>
      <pointLight position={[0.6, 1.4, 2.0]} color="#ffb357" intensity={glow * 3} distance={5} decay={1.5} />
      {/* hiedra */}
      <Scatter geo={IVY} mat={MAT.vcol} shadow={false} items={[[-1.36, 2.15, 1.3, 1.1, 0], [-1.42, 1.5, 1.3, 0.75, 0], [1.38, 2.15, 1.3, 1, 0], [-0.25, 2.18, 1.3, 0.7, 0], [1.5, 2.1, 1.0, 1, Math.PI / 2], [-1.5, 2.12, -0.75, 0.9, -Math.PI / 2]]
        .map(([x, y, z, s, ry], i) => ({ p: [x, y, z] as V3, s, r: ry, c: ['#7aa555', '#86b05c', '#6e9a4e'][i % 3] }))} />
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
    // pasamanos de sección rectangular (listón), no un tubo redondo
    const railShape = new THREE.Shape([[-0.04, -0.035], [0.04, -0.035], [0.04, 0.035], [-0.04, 0.035]].map(([a, b]) => new THREE.Vector2(a, b)));
    const rails = [-0.5, 0.5].map(z => new THREE.ExtrudeGeometry(railShape, { steps: 40, bevelEnabled: false, extrudePath: new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => arc(i / 8, 0.62).setZ(z))) }));
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
        <mesh key={i} geometry={CUSHION} position={[x, 0.13, z]} rotation-y={i * 0.4} scale={[0.28, 0.2, 0.23]} castShadow receiveShadow><meshStandardMaterial color={c} roughness={0.95} /></mesh>
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
        <mesh geometry={BOWL} castShadow receiveShadow><meshStandardMaterial color="#4f8fdc" roughness={0.5} /></mesh>
        <mesh position={[0, 0.13, 0]} scale={[0.255, 0.02, 0.255]} geometry={CYL}><meshStandardMaterial color="#9a5b2c" /></mesh>
      </group>
      <group position={[8.9, 0, 1.45]}>
        <mesh geometry={BOWL} scale={0.93} castShadow receiveShadow><meshStandardMaterial color="#ef8e9c" roughness={0.5} /></mesh>
        <mesh position={[0, 0.12, 0]} scale={[0.235, 0.02, 0.235]} geometry={CYL}><meshStandardMaterial color="#8fd3f4" roughness={0.2} /></mesh>
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
    // guijarros en el borde de algunos tramos de camino y losas planas hundidas en otros dos
    const pebbles = pathEdges(37, 0.5, 0.55, [0.98, 1.15]).filter(([x, z]) => noise2(x * 0.7, z * 0.7) > 0.45)
      .map(([x, z], i) => rockItem(x, -0.02, z, 0.06 + r() * 0.05, 0.05 + r() * 0.04, i % 4, i * 1.9, 0.1));
    const pathStones: Item[] = [];
    ([[0, 0.1, 0.22], [1, 0.7, 0.92]] as const).forEach(([k, u0, u1]) => {
      const { curve, w } = PATH_CURVES[k];
      for (let i = 0; i < 10; i++) {
        const u = u0 + ((u1 - u0) * (i + r() * 0.6)) / 10, p = curve.getPointAt(u), tg = curve.getTangentAt(u), o = (r() - 0.5) * 1.2 * w, s = 0.1 + r() * 0.07;
        pathStones.push({ p: [p.x - tg.z * o, -0.03, p.z + tg.x * o], s: [s, 0.05, s * (0.8 + r() * 0.2)], r: r() * 6.28, v: i });
      }
    });

    const trees: Item[] = TREES.map(([x, z, s], i) => ({ p: [x, 0, z], s, r: i * 1.7, v: i, c: C.leaf[i % 3] }));
    const trunks = trees.map(t => ({ ...t, c: undefined }));

    // arbustos y sus flores: en las matas de arriba, medio metidas entre las hojas y mirando hacia fuera
    const bushes: Item[] = [], blossoms: Item[] = [];
    BUSHES.forEach(([x, z, s, flowers], i) => {
      const v = i % 3, ry = i * 2.7;
      bushes.push({ p: [x, 0, z], s, r: ry, v, c: C.bush[i % 3] });
      if (!flowers) return;
      const top = BUSH_KINDS[v].puffs.filter(p => !p.core && p.c.y > 0.22), pal = i % 2 ? ['#ff9fc4', '#ffc4dc'] : ['#ffffff', '#fff1bf'];
      const rot = new THREE.Quaternion().setFromAxisAngle(Y, ry), q = new THREE.Quaternion(), e = new THREE.Euler();
      for (let k = 0; k < 9; k++) {
        const pf = top[(k * 5 + i) % top.length];
        const dir = pf.c.clone().sub(new THREE.Vector3(0, 0.12, 0)).normalize().add(new THREE.Vector3(r() - 0.5, 0.5, r() - 0.5).multiplyScalar(0.6)).normalize();
        const p = pf.c.clone().addScaledVector(dir, pf.r.x * 0.88).applyQuaternion(rot).multiplyScalar(s);
        e.setFromQuaternion(q.setFromUnitVectors(Y, dir).premultiply(rot));
        blossoms.push({ p: [x + p.x, p.y, z + p.z], s: 0.042 + r() * 0.02, r: [e.x, e.y, e.z], c: pick(pal, r) });
      }
    });

    const rocks: Item[] = [...SHORE_ROCKS, ...FIELD_ROCKS.map(([x, z, hw, h, v], i) => rockItem(x, -0.05, z, hw, h, v, i * 2.3, 0.06))];

    // Flores en corros del mismo color (alguna blanca suelta): pequeños en el césped abierto y más densos junto a
    // árboles, rocas y vallas. Dos modelos (cinco pétalos redondos y margarita) y tamaños distintos.
    const flowerColors = ['#ffe066', '#ffffff', '#ff9fc4', '#c9a3ff', '#ffb36b'];
    const flowers = scatterDecor(11, 30, (x, z, dd, rr) => {
      const c = pick(flowerColors, rr), v = rr() < 0.35 ? 1 : 0, n = 2 + Math.floor(rr() * 2 + rr() ** 2 * 9 * dd), rad = 0.12 + 0.045 * n, out: Item[] = [];
      for (let k = 0; k < n; k++) {
        const a = rr() * 6.28, dist = Math.sqrt(rr()) * rad, px = x + Math.cos(a) * dist, pz = z + Math.sin(a) * dist, s = (v ? 0.065 : 0.055) + rr() * 0.04;
        if (isFree(px, pz)) out.push({ p: [px, 1.4 * s, pz], s, r: [(rr() - 0.5) * 0.3, rr() * 6.28, (rr() - 0.5) * 0.3], v, c: rr() < 0.85 ? c : '#ffffff' });
      }
      return out;
    });

    // Hierba: grupitos de manojos donde hay algo (pies de árbol, rocas, vallas, casa) y en unas manchas de pradera;
    // el resto queda como césped limpio. Hoja ancha sobre todo junto a los objetos; alguna brizna alta suelta.
    const tuft = (x: number, z: number, rr: () => number, v = Math.floor(rr() * 3)): Item => ({ p: [x, -0.01, z], s: 0.5 + rr() * 0.35, r: rr() * 6.28, v, c: pick(GRASS_TONES, rr) });
    const tufts = [
      ...scatterDecor(23, 75, (x, z, dd, rr) => {
        const out: Item[] = [], n = 1 + Math.floor(rr() * (1 + 3 * dd));
        for (let k = 0; k < n; k++) {
          const a = rr() * 6.28, dist = rr() * 0.28, px = x + Math.cos(a) * dist, pz = z + Math.sin(a) * dist;
          if (isFree(px, pz) && offNav(px, pz)) out.push(tuft(px, pz, rr, rr() < 0.25 * dd ? 3 : rr() < 0.1 ? 4 : Math.floor(rr() * 3)));
        }
        return out;
      }),
      ...pathEdges(31, 0.42, 0.6, [0.92, 1.12]).filter(([x, z]) => offNav(x, z) && noise2(x * 0.6 + 5, z * 0.6) > 0.4).map(([x, z]) => tuft(x, z, r)),
      ...FIELD_ROCKS.flatMap(([x, z, hw], i) => [0, 1, 2].map(k => tuft(x + Math.cos(i + k * 2.1) * hw * 1.05, z + Math.sin(i + k * 2.1) * hw * 0.9, r, k === 1 ? 3 : undefined))),
      // alrededor del estanque, sin tapar los extremos del puente
      ...pondOutline(POND_GROW + 0.22, 60).filter(p => r() < 0.4 && offNav(p.x, -p.y) && [[6.13, 4.64], [4.97, 1.66]].every(([bx, bz]) => Math.hypot(p.x - bx, -p.y - bz) > 0.8))
        .map(p => tuft(p.x, -p.y, r)),
    ];
    // corros de tréboles a ras de suelo
    const clovers = scatterDecor(51, 12, (x, z, _, rr) => [{ p: [x, 0, z], s: 0.8 + rr() * 0.5, r: rr() * 6.28, c: pick(['#86cc58', '#96d564', '#78c04e'], rr) }]);

    // estanque: nenúfares con muesca, lotos encima y eneas en la orilla (pie a la altura del agua)
    const lilies: Item[] = ([[3.0, 3.0], [4.6, 3.9], [3.6, 4.2], [6.9, 2.7], [2.6, 3.8]] as const).map(([x, z], i) => ({ p: [x, POND_Y + 0.004, z], s: 0.27 - i * 0.02, r: i * 2.1 + 0.5, c: ['#5cb03c', '#6cbd46', '#4fa236'][i % 3] }));
    const lotus: Item[] = [{ p: [4.6, POND_Y + 0.035, 3.9], s: 0.085, r: 0.3, c: '#ff9fc4' }, { p: [3.0, POND_Y + 0.035, 3.0], s: 0.075, r: 1.1, c: '#ffffff' }];
    const reeds: Item[] = [[2.0, 4.3], [2.2, 4.6], [1.8, 4.0], [7.7, 3.4], [7.9, 3.1], [5.2, 4.6]].map(([x, z], i) => ({ p: [x, POND_Y, z], s: 0.85 + (i % 3) * 0.15, r: i * 2.2 }));

    const gardenFence = fence(FENCES[0], 3);
    const pathFence = fence(FENCES[1], 4);
    // huerto: tierra con caballones, borde de tablas y brotes en hilera
    const mounds: Item[] = [0, 1, 2].map(row => ({ p: [-7.4, 0.06, 0.95 + row * 0.6], s: [0.46, 0.22, 0.5], c: '#8f5f3d' }));
    const bedBoards: Item[] = [
      { p: [-7.4, 0.07, 0.6], s: [2.68, 0.14, 0.08] }, { p: [-7.4, 0.07, 2.6], s: [2.68, 0.14, 0.08] },
      { p: [-8.7, 0.07, 1.6], s: [0.08, 0.14, 2.0] }, { p: [-6.1, 0.07, 1.6], s: [0.08, 0.14, 2.0] },
    ];
    const sprouts: Item[] = [];
    for (let row = 0; row < 3; row++) for (let k = 0; k < 5; k++) sprouts.push({ p: [-8.4 + k * 0.5 + (r() - 0.5) * 0.08, 0.15, 0.95 + row * 0.6], s: 0.85 + r() * 0.35, r: r() * 6.28, c: k % 2 ? '#5fa83a' : '#7cc24e' });

    const white = (l: Item[]) => l.map(it => ({ ...it, c: undefined })); // botones y tallos: su propio color por vértice
    const carpetAvoid = stones.map(({ p: [x, , z], s }): V3 => [x, z, Math.max((s as V3)[0], (s as V3)[2]) * 1.05]); // sin pasto bajo las losas
    return {
      carpetAvoid, stones, pebbles, pathStones, trees, trunks, bushes, blossoms, blossomCores: white(blossoms), rocks, flowers, flowerCores: white(flowers), tufts, clovers,
      lilies, lotus, lotusCores: lotus.map(l => ({ ...l, p: [l.p[0], l.p[1] + 0.01, l.p[2]] as V3, s: 0.05, c: undefined })), reeds,
      posts: [...gardenFence.posts, ...pathFence.posts], rails: [...gardenFence.rails, ...pathFence.rails], mounds, bedBoards, sprouts,
    };
  }, []);

  return (
    <group>
      <Water color={waterColor} sky={sky} />
      <Ground />
      <GrassCarpet avoid={d.carpetAvoid} />
      <Variants geos={FLAGS} mat={MAT.rock} items={d.stones} color={C.stone} shadow={false} />
      <Variants geos={COBBLES} mat={MAT.rock} items={d.pathStones} color="#e2cca6" shadow={false} />
      <Variants geos={ROCKS_LO} mat={MAT.rock} items={d.pebbles} color={C.stone} shadow={false} />
      <Variants geos={TRUNKS} mat={MAT.bark} items={d.trunks} color={C.trunk} />
      <Variants geos={CANOPIES} mat={MAT.foliage} items={d.trees} />
      <Variants geos={BUSH_GEOS} mat={MAT.foliage} items={d.bushes} />
      <Scatter geo={FLOWERS[0]} mat={MAT.vcol} items={d.blossoms} shadow={false} />
      <Scatter geo={BLOSSOM_CORE} mat={MAT.vcol} items={d.blossomCores} shadow={false} />
      <Variants geos={ROCKS} mat={MAT.rock} items={d.rocks} color={C.rock} />
      <Variants geos={FLOWERS} mat={MAT.vcol} items={d.flowers} shadow={false} />
      <Scatter geo={FLOWER_CORE} mat={MAT.vcol} items={d.flowerCores} shadow={false} />
      <Variants geos={TUFTS} mat={MAT.vcol} items={d.tufts} shadow={false} />
      <Scatter geo={CLOVER} mat={MAT.vcol} items={d.clovers} shadow={false} />
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
