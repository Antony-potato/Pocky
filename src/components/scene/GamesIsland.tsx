'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { rng, shaded } from './materials';
import { TREE_KINDS, BUSH_KINDS, ROCKS, ROCK_HW, TUFTS, FLOWERS, FLOWER_CORE, CUSHION } from './shapes';
import { MAT, C, BOX, LAWN, Blades, Scatter, Variants, Dock, type Item } from './Island';
import { GAMES, GAMES_R as R, GAMES_SHORE, PIER, K_A, K_B, K_G, NODES, along, sailK } from './nav';
import { pockyPos } from './Pocky';
import { useIsland, type Spot } from '@/store/islandStore';

// Isla de juegos: a ella va Pocky en barca cuando sale a pasear. Más pequeña y playera que la de casa: un casquete
// de hierba con playa alrededor que se mete en el mar, una plaza, un cine al aire libre (pantalla y pufs) y dos
// máquinas recreativas (los minijuegos). Tocar la pantalla o una máquina la abre (components/Arcade.tsx).

const HEAD = Math.atan2(PIER.dx, PIER.dz); // rumbo de casa a la isla de juegos
const lathe = (pts: [number, number][]) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 64);
// Suelo de una pieza: meseta de hierba, playa que baja suave y se mete en el mar. Perfil (radio, altura) de fuera
// hacia dentro y de abajo arriba (así las caras miran hacia fuera).
const PROFILE: [number, number][] = [[GAMES_SHORE + 0.9, -1.8], [GAMES_SHORE, -1.5], [R + 1.4, -1.15], [R + 0.7, -0.6], [R + 0.15, -0.2], [R - 0.2, -0.04], [R - 0.6, 0], [0, 0]];
const GROUND_GEO = lathe(PROFILE);
/** Altura del suelo a `d` del centro de la isla. */
const groundAt = (d: number) => {
  for (let i = PROFILE.length - 1; i > 0; i--) { const [r1, y1] = PROFILE[i], [r0, y0] = PROFILE[i - 1]; if (d <= r0) return y1 + ((y0 - y1) * (d - r1)) / (r0 - r1); }
  return -1.8;
};
// Dónde acaba el césped y empieza la arena, según el ángulo: un borde ondulado, no un círculo. La misma fórmula
// está en el shader (que además lo muerde con ruido) y aquí, para no plantar pasto ni flores en la arena.
const EDGE = [R - 0.3, 0.18, 0.1, 0.05];
const grassEdge = (a: number) => EDGE[0] + EDGE[1] * Math.sin(3 * a + 1) + EDGE[2] * Math.sin(7 * a + 2) + EDGE[3] * Math.sin(13 * a);
const f = (n: number) => n.toFixed(3);
const lin = (hex: string) => new THREE.Color(hex).toArray().map(f).join(', '); // color lineal para GLSL
const GROUND_MAT = shaded({ color: '#ffffff', roughness: 0.97 }, {
  key: 'games-ground',
  head: LAWN,
  color: /* glsl */ `
    vec2 p = vW.xz, q = p - vec2(${f(GAMES[0])}, ${f(GAMES[1])});
    float a = atan(q.y, q.x), d = length(q);
    float e = ${f(EDGE[0])} + ${f(EDGE[1])} * sin(3. * a + 1.) + ${f(EDGE[2])} * sin(7. * a + 2.) + ${f(EDGE[3])} * sin(13. * a)
      + (vnoise(p * 2.3) - .5) * .3 + (vnoise(p * 7.) - .5) * .1;
    // césped (el mismo tinte que la isla de casa), más seco y amarillento donde se acerca a la arena
    vec3 grass = vec3(${lin(C.grass)}) * lawnTint(p) * mix(vec3(.92, .86, .6), vec3(1.), smoothstep(0., .5, e - d));
    // tierra pisada: la plaza y el camino al embarcadero, con el borde mordido como los caminos de casa
    vec2 dir = vec2(${f(PIER.dx)}, ${f(PIER.dz)});
    float pd = min(d - 1.7, length(q + dir * clamp(dot(q, -dir), 0., ${f(R)})) - .5) + (vnoise(p * 1.4) * .75 + vnoise(p * 4.) * .25 - .5) * .3;
    vec3 dirt = vec3(${lin(C.path)}) * (.91 + .12 * vnoise(p * 1.6)) * mix(.84, 1.03, smoothstep(0., .25, -pd));
    grass = mix(grass, dirt, 1. - smoothstep(-.03, .03, pd));
    // arena: grano a dos escalas, banda mojada junto al agua y sombra húmeda al pie del césped
    vec3 sand = vec3(${lin('#e0cfac')}) * (.93 + .1 * vnoise(p * 4.)) * (.97 + .06 * vnoise(p * 19.));
    sand *= mix(vec3(.74, .76, .8), vec3(1.), smoothstep(-1.5, -1.36, vW.y)) * mix(.84, 1., smoothstep(0., .3, d - e));
    diffuseColor.rgb = mix(sand, grass, 1. - smoothstep(-.05, .05, d - e));`,
});
const DISC = new THREE.CylinderGeometry(1, 1, 1, 40);
const PLANE = new THREE.PlaneGeometry(1, 1);
const PENNANT = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0.26, 0, 0, 0.13, -0.5], 3));
PENNANT.computeVertexNormals();
const CANOPIES = TREE_KINDS.map(k => k.canopy), TRUNKS = TREE_KINDS.map(k => k.trunk), BUSH_GEOS = BUSH_KINDS.map(k => k.geo);

const local = (id: 'g1' | 'g2' | 'g3') => [NODES[id][0] - GAMES[0], NODES[id][1] - GAMES[1]] as const;
const PADS = [local('g1'), local('g2'), local('g3')];
const PAD_COLORS = ['#ff8fa3', '#ffd166', '#7cc8f0'];
// Máquinas: en el puesto rosa el rompeladrillos, en el amarillo la carrera y en el azul la pelota.
const MACHINES: { pad: number; spot: Spot; color: string }[] = [{ pad: 0, spot: 'brick', color: '#e86a8a' }, { pad: 1, spot: 'run', color: '#e0a93a' }, { pad: 2, spot: 'bounce', color: '#4f9fd8' }];
const SCREEN = { x: 1.0, z: -3.9, w: 3.0, h: 1.6875, y: 1.95 }; // pantalla del cine (16:9), al fondo de la isla
// Árboles solo a los lados: delante (sur) tapaban los puestos y a Pocky, y al fondo está la pantalla.
const TREES = [[-4.3, 0.8, 0.8], [4.3, 0.9, 0.75], [3.6, -2.5, 0.8]];
const BUSHES = [[-2.2, 4.0, 0.6], [2.4, 3.9, 0.55], [-4.3, -1.5, 0.6], [3.9, 2.6, 0.6]];
const STONES = [[-1.4, -3.9, 0.45, 0.5, 2], [-0.8, -4.3, 0.3, 0.25, 1], [4.3, -1.2, 0.4, 0.4, 0]];

// Pasto (briznas): por toda la meseta menos donde se pisa o hay algo encima. Coordenadas del mundo.
const bladesFree = (wx: number, wz: number) => {
  const x = wx - GAMES[0], z = wz - GAMES[1], d = Math.hypot(x, z);
  if (d < 1.95 || d > grassEdge(Math.atan2(z, x)) - 0.2) return false; // plaza; borde con la arena
  if (PADS.some(([px, pz]) => Math.hypot(x - px, z - pz) < 1.2)) return false;
  if (Math.abs(x * PIER.dz - z * PIER.dx) < 0.75 && x * PIER.dx + z * PIER.dz < 0) return false; // camino al embarcadero
  if (Math.abs(x - SCREEN.x - 0.1) < 1.75 && z > -2.95 && z < -1.95) return false; // pufs del cine
  return !TREES.some(([tx, tz, s]) => Math.hypot(x - tx, z - tz) < 0.3 * s) && !STONES.some(([sx, sz, hw]) => Math.hypot(x - sx, z - sz) < hw);
};

// Postes del arco de entrada, en coordenadas de la isla.
const ARCH_POSTS = [-0.8, 0.8].map(s => [-PIER.dx * (R - 0.75) + PIER.dz * s, -PIER.dz * (R - 0.75) - PIER.dx * s]);
/** Por dónde puede andar Pocky en esta isla cuando se le toca un punto del suelo (coordenadas del mundo): la hierba,
 *  menos las máquinas, el cine con sus pufs, árboles, arbustos, rocas y el arco. */
export function walkable(wx: number, wz: number) {
  const x = wx - GAMES[0], z = wz - GAMES[1];
  if (Math.hypot(x, z) > grassEdge(Math.atan2(z, x)) - 0.35) return false;
  if (PADS.some(([px, pz]) => Math.hypot(x - px, z - pz + 0.55) < 0.5) || (Math.abs(x - SCREEN.x - 0.1) < 1.9 && z < -1.95)) return false;
  return !TREES.some(([tx, tz, s]) => Math.hypot(x - tx, z - tz) < 0.5 * s) && !BUSHES.some(([bx, bz, s]) => Math.hypot(x - bx, z - bz) < 0.55 * s)
    && !STONES.some(([sx, sz, hw]) => Math.hypot(x - sx, z - sz) < hw + 0.25) && !ARCH_POSTS.some(([ax, az]) => Math.hypot(x - ax, z - az) < 0.35);
}

// Toque (no arrastre: arrastrar gira la cámara) sobre algo de la isla: lo abre a pantalla completa.
const tap = (spot: Spot) => (e: ThreeEvent<MouseEvent>) => { if (e.delta > 8) return; e.stopPropagation(); useIsland.setState({ open: spot }); };

/** Barca: amarrada en el embarcadero de la isla donde está Pocky y, cuando él cruza, debajo de él. Sin estado. */
function Boat() {
  const ref = useRef<THREE.Group>(null!);
  const st = useRef({ k: K_A, yaw: HEAD });
  const parts = useMemo<Item[]>(() => [
    { p: [0, 0.1, 0], s: [1, 0.46, 2.3], c: C.wood },
    { p: [0, 0.11, 1.15], s: [0.72, 0.44, 0.72], r: Math.PI / 4, c: C.wood }, // proa en punta
    { p: [0, 0.31, 0], s: [0.8, 0.06, 2.0], c: C.woodDark }, // cubierta: su cara de arriba es BOAT_Y
    { p: [0.5, 0.38, 0], s: [0.1, 0.14, 2.3], c: '#c98a55' }, { p: [-0.5, 0.38, 0], s: [0.1, 0.14, 2.3], c: '#c98a55' },
    { p: [0, 1.0, -1.0], s: [0.07, 1.4, 0.07], c: C.woodDark }, // palo del banderín, a popa (a proa le tapaba la cara a Pocky)
  ], []);
  const [bx, bz] = along(K_A);
  useFrame(({ clock }, delta) => {
    const g = ref.current, s = st.current, t = clock.elapsedTime;
    const k = THREE.MathUtils.clamp(sailK(pockyPos.x, pockyPos.z), K_A, K_B), [x, z] = along(k);
    // Proa hacia donde va; al llegar a la otra isla se da la vuelta y queda lista para volver.
    s.yaw = k >= K_B ? HEAD + Math.PI : k <= K_A ? HEAD : k > s.k ? HEAD : k < s.k ? HEAD + Math.PI : s.yaw;
    s.k = k;
    g.position.set(x, -1.5, z);
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, s.yaw, 4, Math.min(delta, 0.1));
    g.rotation.z = Math.sin(t * 1.3) * 0.03; // se mece
  });
  return (
    <group ref={ref} position={[bx, -1.5, bz]} rotation-y={HEAD}>
      <Scatter geo={BOX} mat={MAT.wood} items={parts} />
      <mesh geometry={PENNANT} position={[0, 1.42, -1.02]}><meshStandardMaterial color="#ff5c5c" side={THREE.DoubleSide} /></mesh>
    </group>
  );
}

/**
 * Cine al aire libre (como un autocine, con pufs en vez de coches): la pantalla proyecta la foto o el vídeo que
 * haya puesto alguien del hogar. Lo que el navegador no deja usar como textura (enlaces de sitios sin CORS) se
 * queda en blanco aquí, pero se ve al abrir el cine (ahí es un <img>/<video> normal, y el vídeo con sonido).
 */
function Cinema() {
  const cinema = useIsland(s => s.cinema);
  const [shown, setShown] = useState<{ url: string; map: THREE.Texture; aspect: number } | null>(null);
  useEffect(() => {
    if (!cinema) return;
    let off = false, map: THREE.Texture | undefined, video: HTMLVideoElement | undefined;
    const show = (m: THREE.Texture, w: number, h: number) => {
      if (off) return m.dispose();
      m.colorSpace = THREE.SRGBColorSpace;
      map = m;
      setShown({ url: cinema.url, map: m, aspect: w / h });
    };
    if (cinema.kind === 'video') {
      const v = video = document.createElement('video');
      v.crossOrigin = 'anonymous'; v.muted = true; v.loop = true; v.playsInline = true; // sin sonido en la isla: se oye al abrir el cine
      v.onloadeddata = () => show(new THREE.VideoTexture(v), v.videoWidth, v.videoHeight);
      v.src = cinema.url;
      v.play().catch(() => {});
    } else new THREE.TextureLoader().load(cinema.url, t => show(t, t.image.width, t.image.height), undefined, () => {});
    return () => { off = true; map?.dispose(); if (video) { video.pause(); video.removeAttribute('src'); video.load(); } };
  }, [cinema]);
  const on = cinema && shown?.url === cinema.url ? shown : null, k = on ? on.aspect / (SCREEN.w / SCREEN.h) : 1; // encaja entera, con bandas

  const d = useMemo(() => ({
    frame: [
      { p: [-1.2, 0.55, 0], s: [0.16, 1.1, 0.16], c: C.woodDark }, { p: [1.2, 0.55, 0], s: [0.16, 1.1, 0.16], c: C.woodDark },
      { p: [0, SCREEN.y, 0], s: [SCREEN.w + 0.24, SCREEN.h + 0.24, 0.14], c: '#4a4f5c' },
    ] as Item[],
    // Pufs de cara a la pantalla, a un lado del camino que viene del embarcadero.
    puffs: [-0.2, 0.65, 1.5, 2.35].map((x, i): Item => ({ p: [x - SCREEN.x, 0.2, 1.45 + (i % 2) * 0.12], s: [0.36, 0.62, 0.36], r: i * 0.9, c: [...PAD_COLORS, '#c6a4ea'][i] })),
  }), []);
  return (
    <group position={[SCREEN.x, 0, SCREEN.z]}>
      <group onClick={tap('cine')}>
        <Scatter geo={BOX} items={d.frame} />
        <mesh geometry={PLANE} position={[0, SCREEN.y, 0.075]} scale={[SCREEN.w, SCREEN.h, 1]}>
          <meshBasicMaterial color={on ? '#101216' : '#f4f1e8'} toneMapped={false} />
        </mesh>
        {on && (
          <mesh geometry={PLANE} position={[0, SCREEN.y, 0.08]} scale={[SCREEN.w * Math.min(1, k), SCREEN.h * Math.min(1, 1 / k), 1]}>
            <meshBasicMaterial map={on.map} toneMapped={false} />
          </mesh>
        )}
      </group>
      <Scatter geo={CUSHION} items={d.puffs} />
    </group>
  );
}

/** Máquina recreativa sobre su puesto: caja, mando, rótulo y una pantallita encendida. Tocarla abre su minijuego. */
function Machine({ at: [x, z], spot, color }: { at: readonly [number, number]; spot: Spot; color: string }) {
  const parts = useMemo<Item[]>(() => [
    { p: [0, 0.65, 0], s: [0.72, 1.3, 0.6], c: color },
    { p: [0, 0.6, 0.36], s: [0.72, 0.12, 0.3], c: '#3c4150' }, // mando
    { p: [0, 1.42, 0.03], s: [0.78, 0.24, 0.68], c: '#fff3d6' }, // rótulo
    { p: [-0.12, 0.69, 0.4], s: [0.07, 0.1, 0.07], c: '#ff5c5c' }, { p: [0.14, 0.68, 0.42], s: [0.1, 0.05, 0.1], c: '#ffd166' }, // palanca y botón
  ], [color]);
  return (
    <group position={[x, 0, z - 0.5]} onClick={tap(spot)}>
      <Scatter geo={BOX} items={parts} />
      <mesh geometry={PLANE} position={[0, 1.0, 0.305]} scale={[0.54, 0.42, 1]}><meshBasicMaterial color="#9ff3e9" toneMapped={false} /></mesh>
    </group>
  );
}

export default function GamesIsland({ glow }: { glow: number }) {
  const d = useMemo(() => {
    const r = rng(29);
    const trees: Item[] = TREES.map(([x, z, s], i) => ({ p: [x, 0, z], s, r: i * 2.3, v: i + 2, c: C.leaf[i % 3] }));
    const bushes: Item[] = BUSHES.map(([x, z, s], i) => ({ p: [x, 0, z], s, r: i * 2.7, v: i, c: C.bush[i % 3] }));
    const rocks: Item[] = STONES.map(([x, z, hw, h, v], i) => ({ p: [x, -0.05, z], s: [hw / ROCK_HW[v], h, hw / ROCK_HW[v]], r: i * 2.3, v }));
    // Hierba y flores sueltas donde no se pisa: fuera de la plaza, de los puestos, del cine y del camino al embarcadero.
    const free = (x: number, z: number) => Math.hypot(x, z) > 1.9 && Math.hypot(x, z) < grassEdge(Math.atan2(z, x)) - 0.15 && PADS.every(([px, pz]) => Math.hypot(x - px, z - pz) > 1.4)
      && TREES.every(([tx, tz]) => Math.hypot(x - tx, z - tz) > 0.6) && Math.abs(x * PIER.dz - z * PIER.dx) > 0.7
      && !(Math.abs(x - SCREEN.x) < 1.9 && z < -1.9);
    const spots = Array.from({ length: 150 }, () => { const a = r() * 6.28, q = Math.sqrt(r()) * (R - 0.4); return [Math.cos(a) * q, Math.sin(a) * q]; }).filter(([x, z]) => free(x, z));
    const tufts: Item[] = spots.filter((_, i) => i % 3).map(([x, z], i) => ({ p: [x, -0.01, z], s: 0.5 + r() * 0.35, r: r() * 6.28, v: i, c: ['#84c64e', '#74b844', '#93d05a'][i % 3] }));
    const flowers: Item[] = spots.filter((_, i) => i % 3 === 0).map(([x, z], i) => {
      const s = 0.055 + r() * 0.04;
      return { p: [x, 1.4 * s, z], s, r: r() * 6.28, v: i % 2, c: ['#ffe066', '#ffffff', '#ff9fc4', '#c9a3ff', '#ffb36b'][i % 5] };
    });
    // La hierba baja a la playa: matas de duna, más secas, en la arena junto al borde (menos ante el embarcadero), y
    // guijarros sueltos por la arena.
    const dockA = Math.atan2(-PIER.dz, -PIER.dx), dune: Item[] = [];
    for (let i = 0; i < 46; i++) {
      const a = r() * 6.28, q = grassEdge(a) + 0.1 + r() * 0.75;
      if (Math.abs(Math.atan2(Math.sin(a - dockA), Math.cos(a - dockA))) > 0.22) dune.push({ p: [Math.cos(a) * q, groundAt(q) - 0.02, Math.sin(a) * q], s: 0.5 + r() * 0.45, r: r() * 6.28, v: i % 5, c: ['#a9c46a', '#b9cc78', '#8fbf58'][i % 3] });
    }
    for (let i = 0; i < 16; i++) {
      const a = r() * 6.28, q = R + 0.3 + r() * 1.4, hw = 0.06 + r() * 0.09, v = i % 4;
      rocks.push({ p: [Math.cos(a) * q, groundAt(q) - 0.03, Math.sin(a) * q], s: [hw / ROCK_HW[v], 0.05 + r() * 0.06, hw / ROCK_HW[v]], r: r() * 6.28, v });
    }
    // Puestos: aro blanco y disco de color.
    const pads: Item[] = PADS.flatMap(([x, z], i): Item[] => [
      { p: [x, 0.01, z], s: [1.12, 0.04, 1.12], c: '#ffffff' }, { p: [x, 0.03, z], s: [0.95, 0.04, 0.95], c: PAD_COLORS[i] },
    ]);
    // Arco de entrada con banderines, al final del embarcadero.
    const arch: Item[] = [
      { p: [-0.8, 0.9, 0], s: [0.16, 1.8, 0.16] }, { p: [0.8, 0.9, 0], s: [0.16, 1.8, 0.16] }, { p: [0, 1.85, 0], s: [2.0, 0.18, 0.2], c: C.woodDark },
      ...PAD_COLORS.concat(PAD_COLORS).map((c, i): Item => ({ p: [-0.6 + i * 0.24, 1.62, 0], s: [0.16, 0.2, 0.04], r: [0, 0, Math.PI / 4], c })),
    ];
    return { trees, trunks: trees.map(t => ({ ...t, c: undefined })), bushes, rocks, tufts, dune, flowers, flowerCores: flowers.map(f => ({ ...f, c: undefined })), pads, arch };
  }, []);

  const [gx, gz] = GAMES, [dx, dz] = along(K_G - R), [ax, az] = along(K_G - R + 0.75);
  return (
    <>
      <group position={[gx, 0, gz]}>
        <mesh geometry={GROUND_GEO} material={GROUND_MAT} receiveShadow />
        <Scatter geo={DISC} items={d.pads} shadow={false} />
        {MACHINES.map(m => <Machine key={m.spot} at={PADS[m.pad]} spot={m.spot} color={m.color} />)}
        <Cinema />
        <Variants geos={TRUNKS} mat={MAT.bark} items={d.trunks} color={C.trunk} />
        <Variants geos={CANOPIES} mat={MAT.foliage} items={d.trees} />
        <Variants geos={BUSH_GEOS} mat={MAT.foliage} items={d.bushes} />
        <Variants geos={ROCKS} mat={MAT.rock} items={d.rocks} color={C.rock} />
        <Variants geos={TUFTS} mat={MAT.vcol} items={d.tufts} shadow={false} />
        <Variants geos={TUFTS} mat={MAT.vcol} items={d.dune} shadow={false} />
        <Variants geos={FLOWERS} mat={MAT.vcol} items={d.flowers} shadow={false} />
        <Scatter geo={FLOWER_CORE} mat={MAT.vcol} items={d.flowerCores} shadow={false} />
      </group>
      <Blades box={[gx - R, gz - R, gx + R, gz + R]} free={bladesFree} seed={5} />
      <group position={[ax, 0, az]} rotation-y={HEAD}>
        <Scatter geo={BOX} mat={MAT.wood} items={d.arch} color={C.wood} />
      </group>
      <Dock glow={glow} at={[dx, dz]} dir={HEAD + Math.PI} />
      <Boat />
    </>
  );
}
