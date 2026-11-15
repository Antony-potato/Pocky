'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const PUFF = new THREE.SphereGeometry(1, 14, 10);
const SPAN = 15; // cruzan la isla de -SPAN a SPAN y vuelven a entrar por el otro lado

// Nubes que pasan sobre la isla cuando en la ciudad del hogar está nublado (o llueve): proyectan su sombra en el suelo,
// que es lo que más "nubla". `dark`: nubes de lluvia.
// ponytail: bolas aplastadas; a veces tapan a Pocky un momento. Si molesta, bajar `count` u opacidad.
export default function Clouds({ count, dark = false }: { count: number; dark?: boolean }) {
  const group = useRef<THREE.Group>(null!);
  const clouds = useMemo(() => Array.from({ length: count }, (_, i) => {
    const r = (n: number) => { const x = Math.sin((i + 1) * 127.1 * n) * 43758.5; return x - Math.floor(x); }; // fijo por nube: igual en cada render
    return {
      x: (r(1) * 2 - 1) * SPAN, y: 5.5 + r(2) * 1.8, z: (r(3) * 2 - 1) * 8, speed: 0.25 + r(4) * 0.3, size: 1.1 + r(5) * 0.9,
      puffs: [[0, 0, 0, 1], [0.9, -0.1, 0.2, 0.75], [-0.95, -0.12, -0.1, 0.7], [0.2, 0.35, -0.2, 0.7]] as const,
    };
  }), [count]);

  useFrame((_, delta) => {
    group.current.children.forEach((c, i) => {
      c.position.x += clouds[i].speed * Math.min(delta, 0.1);
      if (c.position.x > SPAN) c.position.x = -SPAN;
    });
  });

  return (
    <group ref={group}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]} scale={c.size}>
          {c.puffs.map(([x, y, z, s], j) => (
            <mesh key={j} geometry={PUFF} position={[x, y, z]} scale={[s * 1.25, s * 0.6, s]} castShadow>
              <meshStandardMaterial color={dark ? '#8a94a1' : '#f4f7fa'} transparent opacity={0.88} roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
