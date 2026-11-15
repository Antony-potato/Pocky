'use client';
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const N = 260, TOP = 9, W = 22, D = 18; // gotas sobre toda la isla, una sola draw call

// Lluvia o nieve según el clima real de la ciudad del hogar.
// ponytail: segmentos de 1 px (la nieve, segmentos muy cortos y lentos). Si se quiere más bonito: sprites instanciados.
export default function Rain({ snow = false }: { snow?: boolean }) {
  const geo = useMemo(() => {
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * W, y = Math.random() * TOP, z = (Math.random() - 0.5) * D;
      pos.set([x, y, z, x, y, z], i * 6);
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
  }, []);

  useFrame((_, delta) => {
    const attr = geo.attributes.position as THREE.BufferAttribute, p = attr.array as Float32Array;
    const fall = (snow ? 1.3 : 11) * Math.min(delta, 0.1), len = snow ? 0.07 : 0.45;
    for (let i = 0; i < N; i++) {
      let y = p[i * 6 + 1] - fall;
      if (y < 0) y += TOP;
      p[i * 6 + 1] = y;
      p[i * 6 + 4] = y + len;
    }
    attr.needsUpdate = true;
  });

  return (
    <lineSegments geometry={geo} frustumCulled={false}>
      <lineBasicMaterial color={snow ? '#ffffff' : '#d6ebff'} transparent opacity={snow ? 0.95 : 0.5} depthWrite={false} />
    </lineSegments>
  );
}
