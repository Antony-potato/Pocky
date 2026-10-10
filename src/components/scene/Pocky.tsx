'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent, type ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { usePetStore } from '@/store/petStore';
import type { PetActivity, PetMood } from '@/types/pet';
import { NODES, POI, TOUR, WANDER, findPath, nearestNode, type NodeId, type XZ } from './nav';

// Posición de Pocky, la lee la cámara para seguirle. ponytail: global porque solo hay un Pocky.
export const pockyPos = new THREE.Vector3(NODES.c[0], 0, NODES.c[1]);

const MOOD_MSG: Record<PetMood, string> = {
  happy: '¡Estoy muy feliz!',
  excited: '¡Estoy súper emocionado!',
  neutral: 'Estoy bien... más o menos',
  sad: 'Me siento un poco triste...',
  sick: 'No me siento muy bien...',
  sleeping: 'Zzz...',
};

const FUR = '#efd6ab', LINE = '#8e4e2e', PINK = '#efaab3';

type Pose = 'sit' | 'walk' | 'eat' | 'bath' | 'play' | 'sleep';
type Goal = { pose: Pose; hold: number; face: XZ; until?: number };
const TASKS: Partial<Record<PetActivity, keyof typeof POI>> = { eating: 'eat', bathing: 'bath', playing: 'play' };

const SPHERE = new THREE.SphereGeometry(1, 24, 16);
const LEG = new THREE.CapsuleGeometry(0.085, 0.2, 4, 10).translate(0, -0.185, 0); // pivote arriba
const EAR = new THREE.ConeGeometry(1, 1, 16);
const TAIL = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.12, -0.22), new THREE.Vector3(0.03, 0.38, -0.36), new THREE.Vector3(0.07, 0.6, -0.28),
]), 20, 0.09, 10);

// Contorno de dibujo: copia de la malla por detrás, inflada a lo largo de la normal en espacio de vista
// (grosor constante en el mundo aunque la pieza esté escalada).
const OUTLINE = new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(LINE) }, thickness: { value: 0.022 } },
  vertexShader: 'uniform float thickness; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.xyz += normalize(normalMatrix * normal) * thickness; gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0);\n#include <colorspace_fragment>\n}',
  side: THREE.BackSide,
});

function Part({ geometry, material, shadow = false, ...props }: ThreeElements['group'] & { geometry: THREE.BufferGeometry; material: THREE.Material; shadow?: boolean }) {
  return (
    <group {...props}>
      <mesh geometry={geometry} material={material} castShadow={shadow} />
      <mesh geometry={geometry} material={OUTLINE} />
    </group>
  );
}

function route(from: XZ, to: NodeId): XZ[] {
  return findPath(nearestNode(from), to).map(id => NODES[id]);
}

function turn(o: THREE.Object3D, target: number, dt: number) {
  const d = Math.atan2(Math.sin(target - o.rotation.y), Math.cos(target - o.rotation.y));
  o.rotation.y += d * Math.min(1, dt * 8);
}

export default function Pocky() {
  const activity = usePetStore(s => s.activity);
  const isAsleep = usePetStore(s => s.isAsleep);
  const mood = usePetStore(s => s.mood);
  const need = usePetStore(s => s.needs[0]?.message); // si le falta algo, lo dice en el bocadillo
  const clock = useThree(s => s.clock);
  const gl = useThree(s => s.gl);

  // Bocadillo y corazones: un div normal encima del canvas, recolocado cada frame (sin raíces React extra).
  const ui = useMemo(() => {
    const anchor = document.createElement('div');
    anchor.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:1;will-change:transform';
    const bubble = document.createElement('div');
    bubble.className = 'absolute -translate-x-1/2 -translate-y-full rounded-full px-4 py-1.5 bg-[#ececec] shadow-lg whitespace-nowrap font-nunito font-extrabold text-[15px] text-gray-800';
    anchor.append(bubble);
    return { anchor, bubble, v: new THREE.Vector3() };
  }, []);
  useEffect(() => {
    gl.domElement.parentElement!.append(ui.anchor);
    return () => ui.anchor.remove();
  }, [gl, ui]);
  useEffect(() => { ui.bubble.textContent = (!isAsleep && need) || (MOOD_MSG[mood] ?? '...'); }, [mood, need, isAsleep, ui]);

  const mat = useMemo(() => {
    const grad = new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat);
    grad.minFilter = grad.magFilter = THREE.NearestFilter;
    grad.needsUpdate = true;
    return {
      fur: new THREE.MeshToonMaterial({ color: FUR, gradientMap: grad }),
      pink: new THREE.MeshToonMaterial({ color: PINK, gradientMap: grad }),
      line: new THREE.MeshBasicMaterial({ color: LINE }),
      white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      bubble: new THREE.MeshStandardMaterial({ color: '#e6f7ff', transparent: true, opacity: 0.75 }),
    };
  }, []);

  const root = useRef<THREE.Group>(null!);
  const rig = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const eyes = useRef<THREE.Group>(null!);
  const tail = useRef<THREE.Group>(null!);
  const bubbles = useRef<THREE.Group>(null!);
  const legs = [useRef<THREE.Group>(null!), useRef<THREE.Group>(null!), useRef<THREE.Group>(null!), useRef<THREE.Group>(null!)]; // FL FR BL BR

  const brain = useRef({ route: [] as XZ[], goal: null as Goal | null, fast: false, restUntil: 2, hop: -9, rigY: 0 });

  // Qué hace Pocky cuando cambia el estado compartido (botones de cualquiera de los dos móviles).
  useEffect(() => {
    const b = brain.current, p = root.current.position, here: XZ = [p.x, p.z];
    if (isAsleep) {
      b.route = route(here, POI.sleep.node);
      b.goal = { pose: 'sleep', hold: Infinity, face: POI.sleep.face };
      b.fast = false;
      return;
    }
    if (b.goal?.pose === 'sleep') { b.goal = null; b.route = []; b.restUntil = clock.elapsedTime + 2; }
    const task = TASKS[activity];
    if (task) {
      b.route = route(here, POI[task].node);
      b.goal = { pose: task, hold: 5, face: POI[task].face };
      b.fast = true;
    } else if (activity === 'walking') {
      let from = here;
      b.route = TOUR.flatMap(stop => { const r = route(from, stop); from = NODES[stop]; return r; });
      b.goal = null;
      b.fast = true;
    }
  }, [activity, isAsleep, clock]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1), t = state.clock.elapsedTime, b = brain.current, g = root.current, p = g.position;
    const slow = mood === 'sad' || mood === 'sick' ? 0.6 : 1;
    let pose: Pose = 'sit';

    if (b.route.length) {
      const [tx, tz] = b.route[0], dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.05) {
        b.route.shift();
        if (!b.route.length) {
          b.fast = false;
          if (b.goal) b.goal.until = t + b.goal.hold;
          else b.restUntil = t + 3 + Math.random() * 6;
        }
      } else {
        const step = Math.min(d, (b.fast ? 2.3 : 1.0) * slow * dt);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        turn(g, Math.atan2(dx, dz), dt);
      }
      pose = 'walk';
    } else if (b.goal && t < (b.goal.until ?? 0)) {
      pose = b.goal.pose;
      turn(g, Math.atan2(b.goal.face[0] - p.x, b.goal.face[1] - p.z), dt);
    } else {
      b.goal = null;
      if (t > b.restUntil) {
        const here = nearestNode([p.x, p.z]), options = WANDER.filter(n => n !== here);
        b.route = route([p.x, p.z], options[Math.floor(Math.random() * options.length)]);
      }
    }
    pockyPos.copy(p);
    ui.v.set(p.x, 2.3 + b.rigY, p.z).project(state.camera);
    ui.anchor.style.transform = `translate(${((ui.v.x + 1) / 2) * state.size.width}px, ${((1 - ui.v.y) / 2) * state.size.height}px)`;

    // ---- Pose: valores objetivo de cada articulación; se suavizan con damp ----
    let rigY = 0, rigRZ = 0, rigRY = 0, bodyY = 0.46, bodyRX = 0, bodySY = 1 + Math.sin(t * 2) * 0.015;
    let headY = 0.95, headZ = 0.2, headRX = 0, headRY = 0, headRZ = 0, tailRX = -0.2, tailRZ = Math.sin(t * 2) * 0.25;
    let legR = [0, 0, 0, 0], legY = [0.36, 0.36, 0.36, 0.36], eyeS = t % 3.7 < 0.12 ? 0.1 : 1;
    if (slow < 1) { headRX = 0.25; tailRX = -0.9; }

    if (pose === 'walk') {
      const w = t * (b.fast ? 14 : 9), sw = Math.sin(w) * 0.65;
      legR = [sw, -sw, -sw, sw];
      bodyY += Math.abs(Math.cos(w)) * 0.03;
      headRX += Math.sin(w * 2) * 0.04;
      tailRZ = Math.sin(w * 0.5) * 0.35;
    } else if (pose === 'sit') {
      bodyRX = -0.45; bodyY = 0.42;
      legR = [0.25, 0.25, -1.4, -1.4]; legY = [0.36, 0.36, 0.14, 0.14];
      headY = 1.0; headZ = 0.12; headRY = Math.sin(t * 0.5) * 0.5 + Math.sin(t * 1.3) * 0.1;
      tailRX = -1.15; tailRZ = Math.sin(t * 1.2) * 0.4;
    } else if (pose === 'eat') {
      headY = 0.72; headZ = 0.36; headRX = 0.6 + Math.sin(t * 14) * 0.06;
      tailRZ = Math.sin(t * 6) * 0.45;
    } else if (pose === 'bath') {
      rigRZ = t % 1.6 < 0.7 ? Math.sin(t * 30) * 0.12 : 0;
      eyeS = 0.25; tailRZ = Math.sin(t * 9) * 0.3;
    } else if (pose === 'play') {
      const j = Math.abs(Math.sin(t * 5.5));
      rigY = j * 0.55; rigRY = Math.sin(t * 2.75) * 0.9;
      legR = [-0.9 * j, -0.9 * j, 0.5 * j, 0.5 * j];
      headRZ = Math.sin(t * 3) * 0.25; tailRZ = Math.sin(t * 10) * 0.5; tailRX = -0.4;
    } else if (pose === 'sleep') {
      rigY = 0.1; bodyY = 0.3; bodySY = 0.85 + Math.sin(t * 1.6) * 0.04;
      legR = [-1.45, -1.45, 1.45, 1.45]; legY = [0.12, 0.12, 0.12, 0.12];
      headY = 0.55; headZ = 0.34; headRX = 0.2; headRZ = 0.4; eyeS = 0.08;
      tailRX = -1.45; tailRZ = 0.9;
    }

    const k = (v: number, target: number, l = 10) => THREE.MathUtils.damp(v, target, l, dt);
    b.rigY = k(b.rigY, rigY, 14);
    const hop = t - b.hop < 0.45 ? Math.sin(((t - b.hop) / 0.45) * Math.PI) * 0.4 : 0;
    rig.current.position.y = b.rigY + hop;
    rig.current.rotation.z = k(rig.current.rotation.z, rigRZ, 20);
    rig.current.rotation.y = k(rig.current.rotation.y, rigRY, 8);
    body.current.position.y = k(body.current.position.y, bodyY);
    body.current.rotation.x = k(body.current.rotation.x, bodyRX);
    body.current.scale.y = k(body.current.scale.y, bodySY);
    head.current.position.y = k(head.current.position.y, headY);
    head.current.position.z = k(head.current.position.z, headZ);
    head.current.rotation.x = k(head.current.rotation.x, headRX);
    head.current.rotation.y = k(head.current.rotation.y, headRY, 6);
    head.current.rotation.z = k(head.current.rotation.z, headRZ);
    tail.current.rotation.x = k(tail.current.rotation.x, tailRX, 6);
    tail.current.rotation.z = k(tail.current.rotation.z, tailRZ, 8);
    eyes.current.scale.y = k(eyes.current.scale.y, eyeS, 30);
    legs.forEach((l, i) => {
      l.current.rotation.x = k(l.current.rotation.x, legR[i], 18);
      l.current.position.y = k(l.current.position.y, legY[i]);
    });

    bubbles.current.visible = pose === 'bath';
    if (pose === 'bath') bubbles.current.children.forEach((m, i) => {
      const u = (t * 0.7 + i / 6) % 1, a = i * 1.05 + t * 1.5;
      m.position.set(Math.cos(a) * 0.55, 0.3 + u * 1.3, Math.sin(a) * 0.55);
      m.scale.setScalar(0.05 + 0.05 * Math.sin(u * Math.PI));
    });
  });

  const onTap = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    brain.current.hop = clock.elapsedTime;
    for (let i = 0; i < 5; i++) {
      const h = document.createElement('span');
      h.textContent = '❤️';
      h.className = 'absolute text-lg animate-float-up';
      h.style.cssText = `left:${i * 16 - 40}px;top:20px;animation-delay:${i * 0.1}s;opacity:0`;
      h.onanimationend = () => h.remove();
      ui.anchor.append(h);
    }
    navigator.vibrate?.(30);
  };

  return (
    <group ref={root} position={[pockyPos.x, 0, pockyPos.z]} scale={1.2} onClick={onTap}>
      <group ref={rig}>
        <group ref={body} position={[0, 0.46, 0]}>
          <Part geometry={SPHERE} material={mat.fur} scale={[0.32, 0.3, 0.42]} shadow />
          <Part geometry={SPHERE} material={mat.fur} position={[0, 0.06, 0.3]} scale={[0.2, 0.2, 0.13]} />
        </group>

        <group ref={head} position={[0, 0.95, 0.2]}>
          <Part geometry={SPHERE} material={mat.fur} scale={[0.5, 0.42, 0.42]} shadow />
          {[-1, 1].map(s => (
            <group key={s}>
              <Part geometry={SPHERE} material={mat.fur} position={[0.4 * s, -0.13, 0.02]} scale={0.16} />
              <Part geometry={EAR} material={mat.fur} position={[0.28 * s, 0.4, -0.02]} rotation-z={-0.32 * s} scale={[0.18, 0.4, 0.15]} shadow />
              <mesh geometry={EAR} material={mat.pink} position={[0.28 * s, 0.37, 0.06]} rotation-z={-0.32 * s} scale={[0.1, 0.26, 0.08]} />
            </group>
          ))}
          <Part geometry={EAR} material={mat.fur} position={[0.05, 0.47, 0.08]} rotation-z={-0.4} scale={[0.07, 0.26, 0.07]} />
          <group ref={eyes}>
            {[-1, 1].map(s => (
              <group key={s}>
                <mesh geometry={SPHERE} material={mat.line} position={[0.2 * s, 0, 0.37]} scale={[0.13, 0.15, 0.06]} />
                <mesh geometry={SPHERE} material={mat.white} position={[0.2 * s - 0.075, 0.04, 0.425]} scale={[0.035, 0.06, 0.02]} />
              </group>
            ))}
          </group>
          <mesh geometry={SPHERE} material={mat.line} position={[0, -0.13, 0.405]} scale={[0.045, 0.03, 0.025]} />
          <mesh material={mat.line} position={[0, -0.19, 0.385]}><boxGeometry args={[0.014, 0.07, 0.01]} /></mesh>
        </group>

        {([[-0.15, 0.2], [0.15, 0.2], [-0.16, -0.2], [0.16, -0.2]] as const).map(([x, z], i) => (
          <group key={i} ref={legs[i]} position={[x, 0.36, z]}>
            <Part geometry={LEG} material={mat.fur} shadow />
          </group>
        ))}

        <group ref={tail} position={[0, 0.45, -0.36]}>
          <Part geometry={TAIL} material={mat.fur} shadow />
          <mesh geometry={SPHERE} material={mat.fur} position={[0.07, 0.6, -0.28]} scale={0.09} />
        </group>

        <group ref={bubbles} visible={false}>
          {Array.from({ length: 6 }, (_, i) => <mesh key={i} geometry={SPHERE} material={mat.bubble} />)}
        </group>
      </group>
    </group>
  );
}
