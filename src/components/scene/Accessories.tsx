'use client';
import * as THREE from 'three';
import { Part, toon } from './toon';

// Accesorios de Pocky, en coordenadas del grupo `head` de Pocky.tsx (cabeza: esfera de 0.5 × 0.42 × 0.42,
// orejas en ±0.28, 0.4). Lo de cuello va bajo la barbilla, así acompaña a la cabeza en todas las poses.
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const DOME = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2); // media esfera (gorro)
const CYL = new THREE.CylinderGeometry(1, 1, 1, 24);
const CONE = new THREE.ConeGeometry(1, 1, 12);
const RING = new THREE.TorusGeometry(1, 0.18, 10, 32); // el grosor se escala con z
const THIN = new THREE.TorusGeometry(1, 0.1, 8, 28);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const FLAT = [Math.PI / 2, 0, 0] as const; // aro tumbado (alrededor del cuello / de la cabeza)

const ITEMS: Record<string, React.ReactNode> = {
  bow: (
    <group position={[0.2, 0.34, 0.13]} rotation-z={-0.35}>
      {[-1, 1].map(s => <Part key={s} geometry={SPHERE} material={toon('#ff6fa3')} position-x={0.1 * s} rotation-z={0.4 * s} scale={[0.11, 0.07, 0.05]} />)}
      <Part geometry={SPHERE} material={toon('#e0457f')} scale={0.045} />
    </group>
  ),
  beanie: (
    <group position-y={0.16}>
      <Part geometry={DOME} material={toon('#5b8def')} scale={[0.43, 0.28, 0.38]} />
      <Part geometry={RING} material={toon('#f1ece2')} rotation={FLAT} scale={[0.435, 0.385, 0.32]} />
      <Part geometry={SPHERE} material={toon('#f1ece2')} position-y={0.3} scale={0.085} />
    </group>
  ),
  strawhat: (
    <group position-y={0.33} rotation-z={0.1}>
      <Part geometry={CYL} material={toon('#e9c46a')} scale={[0.64, 0.03, 0.6]} />
      <Part geometry={CYL} material={toon('#e9c46a')} position-y={0.11} scale={[0.3, 0.2, 0.3]} />
      <mesh geometry={CYL} material={toon('#e5484d')} position-y={0.05} scale={[0.305, 0.06, 0.305]} />
    </group>
  ),
  flower: (
    <group position={[-0.3, 0.33, 0.14]} rotation-z={0.3}>
      {[0, 1, 2, 3, 4].map(i => (
        <Part key={i} geometry={SPHERE} material={toon('#ffffff')} position={[Math.cos(i * 1.257) * 0.07, Math.sin(i * 1.257) * 0.07, 0]} scale={[0.055, 0.055, 0.025]} />
      ))}
      <mesh geometry={SPHERE} material={toon('#ffc93c')} position-z={0.02} scale={0.04} />
    </group>
  ),
  crown: (
    <group position-y={0.44}>
      <Part geometry={CYL} material={toon('#f5c542')} scale={[0.19, 0.13, 0.19]} />
      {[0, 1, 2, 3, 4].map(i => (
        <Part key={i} geometry={CONE} material={toon('#f5c542')} position={[Math.sin(i * 1.257) * 0.16, 0.15, Math.cos(i * 1.257) * 0.16]} scale={[0.045, 0.17, 0.045]} />
      ))}
      {[0, 1, 2, 3, 4].map(i => (
        <mesh key={i} geometry={SPHERE} material={toon('#ffffff')} position={[Math.sin(i * 1.257) * 0.16, 0.245, Math.cos(i * 1.257) * 0.16]} scale={0.022} />
      ))}
      <mesh geometry={SPHERE} material={toon('#e5484d')} position={[0, 0, 0.19]} scale={[0.035, 0.035, 0.015]} />
    </group>
  ),
  glasses: (
    <group position-z={0.45}>
      {[-1, 1].map(s => <mesh key={s} geometry={THIN} material={toon('#2b2622')} position-x={0.2 * s} scale={0.13} />)}
      <mesh geometry={BOX} material={toon('#2b2622')} position-y={0.03} scale={[0.12, 0.02, 0.02]} />
    </group>
  ),
  bell: (
    <group position={[0, -0.36, -0.02]}>
      <Part geometry={RING} material={toon('#e5484d')} rotation={FLAT} scale={[0.27, 0.25, 0.22]} />
      <Part geometry={SPHERE} material={toon('#f5c542')} position={[0, -0.08, 0.27]} scale={0.065} />
    </group>
  ),
  scarf: (
    <group position={[0, -0.36, -0.02]}>
      <Part geometry={RING} material={toon('#3fa7a0')} rotation={FLAT} scale={[0.28, 0.26, 0.45]} />
      <Part geometry={BOX} material={toon('#3fa7a0')} position={[0.13, -0.14, 0.24]} rotation-z={0.25} scale={[0.1, 0.22, 0.04]} />
    </group>
  ),
};

/** Lo que lleva puesto (ids de ACCESSORIES en petLogic; '' = nada en ese hueco). */
export default function Outfit({ ids }: { ids: string[] }) {
  return <>{ids.map(id => ITEMS[id] && <group key={id}>{ITEMS[id]}</group>)}</>;
}
