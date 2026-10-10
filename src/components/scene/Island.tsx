'use client';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

// Isla generada por código (sin modelos externos). Mundo: x derecha, z hacia la cámara (sur), y arriba.
// La hierba está en y = 0. Las posiciones de los sitios coinciden con los nodos de nav.ts.

export const RX = 9.6;
export const RZ = 7.4;
const edgeR = (a: number) => 1 + 0.05 * Math.sin(3 * a + 1) + 0.03 * Math.sin(5 * a + 2);
const edgeAt = (a: number, k = 1): [number, number] => [Math.cos(a) * RX * edgeR(a) * k, Math.sin(a) * RZ * edgeR(a) * k];

const C = {
  grass: '#94cc5c', dirt: '#c48e5c', path: '#e2bd86', stone: '#d4cbbd', rock: '#bdb5aa',
  trunk: '#8a5a3b', wood: '#a86f42', woodDark: '#8b5a33', leaf: ['#7cbf4e', '#8ed05c', '#6db347'],
  bush: '#6aad45', water: '#62c0ea', rim: '#d9c99c',
};

const SPHERE = new THREE.SphereGeometry(1, 16, 12);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const TRUNK = new THREE.CylinderGeometry(0.75, 1, 1, 10);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 7);

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type V3 = [number, number, number];
type Item = { p: V3; s?: number | V3; r?: number; c?: string };

// Un InstancedMesh por tipo de pieza: pocas draw calls para que vaya fluido en móvil.
function Scatter({ items, geo, color = '#ffffff', shadow = true, glow = false }: {
  items: Item[]; geo: THREE.BufferGeometry; color?: string; shadow?: boolean; glow?: boolean;
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
    <instancedMesh ref={ref} args={[geo, undefined, items.length]} castShadow={shadow} receiveShadow>
      {glow ? <meshBasicMaterial toneMapped={false} /> : <meshStandardMaterial roughness={0.9} />}
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
      {geos.map((g, i) => <mesh key={i} geometry={g} receiveShadow><meshStandardMaterial color={C.path} roughness={1} /></mesh>)}
      <mesh position={[ex, 0.019, ez]} rotation-x={-Math.PI / 2} receiveShadow><circleGeometry args={[PATHS[1].w, 20]} /><meshStandardMaterial color={C.path} roughness={1} /></mesh>
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
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 1 });
      g.rotateX(-Math.PI / 2);
      g.translate(0, top - depth - bevel, 0);
      return g;
    };
    const foam = shape(1.09);
    foam.holes.push(new THREE.Path(shape(1.0).getPoints()));
    const foamGeo = new THREE.ShapeGeometry(foam);
    foamGeo.rotateX(-Math.PI / 2);
    return { grass: slab(shape(1), 0.3, 0.3, 0), dirt: slab(shape(0.985), 1.7, 0.3, -0.42), foam: foamGeo };
  }, []);
  const foamMat = useRef<THREE.MeshBasicMaterial>(null!);
  useFrame(({ clock }) => { foamMat.current.opacity = 0.35 + Math.sin(clock.elapsedTime * 1.3) * 0.15; });
  return (
    <>
      <mesh geometry={geos.grass} receiveShadow><meshStandardMaterial color={C.grass} roughness={0.95} /></mesh>
      <mesh geometry={geos.dirt} receiveShadow castShadow><meshStandardMaterial color={C.dirt} roughness={1} /></mesh>
      <mesh geometry={geos.foam} position={[0, -1.47, 0]}><meshBasicMaterial ref={foamMat} color="#ffffff" transparent depthWrite={false} /></mesh>
    </>
  );
}

function Water({ color }: { color: string }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -1.5, 0]} receiveShadow>
      <planeGeometry args={[160, 160]} />
      <meshStandardMaterial color={color} roughness={0.35} metalness={0.05} />
    </mesh>
  );
}

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
  return (
    <group position={[HOUSE.x, 0, HOUSE.z]}>
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow><boxGeometry args={[3.15, 0.36, 2.75]} /><meshStandardMaterial color="#c9baa3" /></mesh>
      <mesh position={[0, 1.2, 0]} castShadow receiveShadow><boxGeometry args={[3, 2.1, 2.6]} /><meshStandardMaterial color="#f0dfc2" /></mesh>
      <mesh geometry={roof} position={[0, 2.2, 0]} castShadow receiveShadow><meshStandardMaterial color="#dcaa62" roughness={1} /></mesh>
      <mesh position={[-0.8, 3.2, -0.5]} castShadow><boxGeometry args={[0.5, 1.4, 0.5]} /><meshStandardMaterial color="#b4aca2" /></mesh>
      <group ref={smoke} position={[-0.8, 4.0, -0.5]}>
        {[0, 1, 2].map(i => <mesh key={i} geometry={SPHERE}><meshStandardMaterial color="#ffffff" transparent depthWrite={false} /></mesh>)}
      </group>
      {/* puerta, pomo, ventanas, farol */}
      <RoundedBox args={[0.8, 1.3, 0.12]} radius={0.06} position={[0.35, 0.95, 1.31]}><meshStandardMaterial color={C.woodDark} /></RoundedBox>
      <mesh geometry={SPHERE} position={[0.6, 0.95, 1.39]} scale={0.05}><meshStandardMaterial color="#e8c35a" /></mesh>
      <mesh position={[-0.85, 1.35, 1.31]}><boxGeometry args={[0.6, 0.6, 0.08]} />{win}</mesh>
      <mesh position={[-1.51, 1.35, 0]} rotation-y={Math.PI / 2}><boxGeometry args={[0.6, 0.6, 0.08]} />{win}</mesh>
      <mesh position={[1.05, 1.55, 1.38]}><boxGeometry args={[0.18, 0.26, 0.18]} />{win}</mesh>
      <pointLight position={[0.6, 1.4, 2.0]} color="#ffb357" intensity={glow * 3} distance={5} decay={1.5} />
      {/* hiedra */}
      <Scatter geo={SPHERE} items={[[-1.4, 2.0, 1.3, 0.22], [-1.2, 1.7, 1.33, 0.18], [-1.45, 1.5, 1.3, 0.2], [1.3, 2.0, 1.32, 0.2], [1.45, 1.75, 1.2, 0.18], [-0.3, 2.15, 1.33, 0.16]]
        .map(([x, y, z, s]) => ({ p: [x, y, z] as V3, s, c: C.leaf[Math.round(s * 10) % 3] }))} />
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
    return { p: [Math.cos(a) * 0.48, 0.07, Math.sin(a) * 0.48] as V3, s: [0.15, 0.11, 0.13] as V3, r: a };
  });
  return (
    <group position={[FIRE.x, 0, FIRE.z]}>
      <Scatter geo={SPHERE} items={stones} color={C.rock} />
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
      <Scatter geo={BOX} color={C.woodDark} items={[-1.55, 1.55].flatMap(x => [-0.5, 0.5].map(z => ({ p: [x, 0.35, z] as V3, s: [0.1, 0.7, 0.1] as V3 })))} />
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
        <RoundedBox key={i} args={[0.55, 0.18, 0.45]} radius={0.08} position={[x, 0.14, z]} rotation-y={i * 0.4} castShadow><meshStandardMaterial color={c} /></RoundedBox>
      ))}
    </group>
  );
}

function Bench() {
  return (
    <group position={[8.0, 0, -2.6]} rotation-y={0.35}>
      <mesh position={[0, 0.45, 0]} castShadow><boxGeometry args={[1.4, 0.1, 0.45]} /><meshStandardMaterial color={C.wood} /></mesh>
      <mesh position={[0, 0.78, -0.2]} castShadow><boxGeometry args={[1.4, 0.38, 0.08]} /><meshStandardMaterial color={C.wood} /></mesh>
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
      <mesh position={[0.5, -0.05, 2.1]}><boxGeometry args={[0.16, 0.22, 0.16]} /><meshStandardMaterial color="#ffd27a" emissive="#ffb347" emissiveIntensity={0.3 + glow * 2} /></mesh>
    </group>
  );
}

// ---------- Isla ----------

export default function Island({ waterColor, glow }: { waterColor: string; glow: number }) {
  const d = useMemo(() => {
    const r = rng(7);
    const stones: Item[] = Array.from({ length: 8 }, (_, i) => {
      const t = i / 7, x = -0.9 + (-4.4) * t, z = 0.4 + (-1.4) * t;
      return { p: [x + (i % 2 ? 0.18 : -0.18) * 0.5, 0.03, z + (i % 2 ? 0.2 : -0.2)], s: [0.32 + r() * 0.1, 0.05, 0.24 + r() * 0.08] };
    });

    const trunks: Item[] = TREES.map(([x, z, s]) => ({ p: [x, s, z], s: [0.24 * s, 2 * s, 0.24 * s] }));
    const canopy: Item[] = TREES.flatMap(([x, z, s], i) => {
      const a = i * 1.7, ca = Math.cos(a), sa = Math.sin(a);
      return CANOPY.map(([ox, oy, oz, os], j) => ({ p: [x + (ox * ca - oz * sa) * s, oy * s, z + (ox * sa + oz * ca) * s] as V3, s: os * s, c: C.leaf[(i + j) % 3] }));
    });

    const bushes: Item[] = [], bushFlowers: Item[] = [];
    BUSHES.forEach(([x, z, s, flowers], i) => {
      ([[0, 0.35, 0, 0.5], [0.38, 0.28, 0.1, 0.38], [-0.35, 0.27, -0.05, 0.4]] as const).forEach(([ox, oy, oz, os], j) =>
        bushes.push({ p: [x + ox * s, oy * s, z + oz * s], s: os * s, c: j === 1 ? C.leaf[i % 3] : C.bush }));
      if (flowers) for (let k = 0; k < 6; k++) {
        const a = k * 1.1 + i, h = 0.25 + (k % 3) * 0.12;
        bushFlowers.push({ p: [x + Math.cos(a) * 0.42 * s, h * s + 0.15, z + Math.sin(a) * 0.42 * s + 0.08], s: 0.06, c: k % 2 ? '#ff9fc4' : '#ffffff' });
      }
    });

    const shoreRocks: Item[] = ([[200, 1.1], [150, 0.9], [25, 1.2], [340, 0.85], [75, 0.9], [112, 0.7], [255, 0.8]] as const).map(([deg, s]) => {
      const [x, z] = edgeAt((deg * Math.PI) / 180, 1.04);
      return { p: [x, -0.75, z], s: [1.0 * s, 0.85 * s, 0.9 * s], r: deg };
    });
    const rocks: Item[] = [...shoreRocks, ...([[-7.2, 4.4, 0.5], [-7.9, 3.9, 0.35], [1.2, 5.7, 0.45], [1.9, 5.4, 0.3], [-4.2, -4.7, 0.3]] as const).map(([x, z, s]) => ({ p: [x, s * 0.4, z] as V3, s: [s, s * 0.75, s * 0.85] as V3 }))];

    const flowerColors = ['#ffe066', '#ffffff', '#ff9fc4', '#c9a3ff', '#ffb36b'];
    const flowers = scatterFree(11, 150, (x, z, rr) => ({ p: [x, 0.09, z], s: 0.065 + rr() * 0.03, c: flowerColors[Math.floor(rr() * flowerColors.length)] }));
    const tufts = scatterFree(23, 170, (x, z, rr) => ({ p: [x, 0.11, z], s: [0.05, 0.22 + rr() * 0.12, 0.05], c: rr() > 0.5 ? '#78b84a' : '#6aa843' }));

    const pond: Item[] = PONDS.flatMap(p => [
      { p: [p.x, 0.02, p.z] as V3, s: [p.rx + 0.22, 0.04, p.rz + 0.22] as V3, c: C.rim },
      { p: [p.x, 0.03, p.z] as V3, s: [p.rx, 0.05, p.rz] as V3, c: C.water },
    ]);
    const lilies: Item[] = ([[3.0, 3.0], [4.6, 3.9], [3.6, 4.2], [6.9, 2.7], [2.6, 3.8]] as const).map(([x, z], i) => ({ p: [x, 0.065, z], s: [0.26 - i * 0.02, 0.015, 0.26 - i * 0.02], c: '#5a9e3a' }));
    const lotus: Item[] = [{ p: [4.6, 0.11, 3.9], s: 0.08, c: '#ff9fc4' }, { p: [3.0, 0.11, 3.0], s: 0.07, c: '#ffffff' }];
    const reedSpots = [[2.0, 4.3], [2.2, 4.6], [1.8, 4.0], [7.7, 3.4], [7.9, 3.1], [5.2, 4.6]];
    const reeds: Item[] = reedSpots.map(([x, z], i) => ({ p: [x, 0.45, z], s: [0.03, 0.9 + (i % 3) * 0.15, 0.03] }));
    const reedTops: Item[] = reedSpots.map(([x, z], i) => ({ p: [x, 0.95 + (i % 3) * 0.075, z], s: [0.06, 0.16, 0.06] }));

    const gardenFence = fence([[-8.9, 2.95], [-5.85, 2.95], [-5.85, 0.35]]);
    const pathFence = fence([[-1.5, 6.1], [-0.4, 6.4]]);
    const sprouts: Item[] = [];
    for (let row = 0; row < 3; row++) for (let k = 0; k < 5; k++) sprouts.push({ p: [-8.4 + k * 0.5, 0.3, 0.9 + row * 0.6], s: [0.1, 0.24, 0.1], c: k % 2 ? '#5fa83a' : '#7cc24e' });

    return { stones, trunks, canopy, bushes, bushFlowers, rocks, flowers, tufts, pond, lilies, lotus, reeds, reedTops,
      posts: [...gardenFence.posts, ...pathFence.posts], rails: [...gardenFence.rails, ...pathFence.rails], sprouts };
  }, []);

  return (
    <group>
      <Water color={waterColor} />
      <Ground />
      <PathRibbons />
      <Scatter geo={SPHERE} items={d.stones} color={C.stone} shadow={false} />
      <Scatter geo={TRUNK} items={d.trunks} color={C.trunk} />
      <Scatter geo={SPHERE} items={d.canopy} />
      <Scatter geo={SPHERE} items={d.bushes} />
      <Scatter geo={SPHERE} items={d.bushFlowers} shadow={false} />
      <Scatter geo={SPHERE} items={d.rocks} color={C.rock} />
      <Scatter geo={SPHERE} items={d.flowers} shadow={false} />
      <Scatter geo={CONE} items={d.tufts} shadow={false} />
      <Scatter geo={CYL} items={d.pond} shadow={false} />
      <Scatter geo={CYL} items={d.lilies} shadow={false} />
      <Scatter geo={SPHERE} items={d.lotus} shadow={false} />
      <Scatter geo={CYL} items={d.reeds} color="#6aa843" />
      <Scatter geo={SPHERE} items={d.reedTops} color="#8a5a3b" />
      <Scatter geo={BOX} items={d.posts} color={C.woodDark} />
      <Scatter geo={BOX} items={d.rails} color={C.wood} />
      {/* huerto */}
      <mesh position={[-7.4, 0.08, 1.6]} receiveShadow><boxGeometry args={[2.6, 0.16, 2.0]} /><meshStandardMaterial color="#8a5a3a" /></mesh>
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
