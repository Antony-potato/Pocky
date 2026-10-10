'use client';
import * as THREE from 'three';
import type { ThreeElements } from '@react-three/fiber';

// Estilo "dibujo" compartido por Pocky y las golosinas: sombreado toon de 3 tonos + contorno marrón.
export const LINE = '#8e4e2e';

const GRADIENT = new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat);
GRADIENT.minFilter = GRADIENT.magFilter = THREE.NearestFilter;
GRADIENT.needsUpdate = true;

const cache = new Map<string, THREE.MeshToonMaterial>();
export function toon(color: string) {
  let m = cache.get(color);
  if (!m) cache.set(color, m = new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT }));
  return m;
}

// Contorno: copia de la malla por detrás, inflada a lo largo de la normal en espacio de vista
// (grosor constante en el mundo aunque la pieza esté escalada).
const OUTLINE = new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(LINE) }, thickness: { value: 0.022 } },
  vertexShader: 'uniform float thickness; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.xyz += normalize(normalMatrix * normal) * thickness; gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0);\n#include <colorspace_fragment>\n}',
  side: THREE.BackSide,
});

export function Part({ geometry, material, shadow = false, ...props }: ThreeElements['group'] & { geometry: THREE.BufferGeometry; material: THREE.Material; shadow?: boolean }) {
  return (
    <group {...props}>
      <mesh geometry={geometry} material={material} castShadow={shadow} />
      <mesh geometry={geometry} material={OUTLINE} />
    </group>
  );
}
