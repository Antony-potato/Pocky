'use client';
import * as THREE from 'three';
import { Part, toon } from './toon';

// Golosinas que caen del cielo al pulsar "Golosina". Todas con el origen en el suelo (y = 0 = apoyada).
export const TREAT_KINDS = ['caramelo', 'galleta', 'piruleta', 'dona', 'cupcake'] as const;
export type TreatKind = (typeof TREAT_KINDS)[number];
export const TREAT_NAME: Record<TreatKind, string> = {
  caramelo: 'un caramelo', galleta: 'una galleta', piruleta: 'una piruleta', dona: 'una dona', cupcake: 'un cupcake',
};

const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 22);
const CUP = new THREE.CylinderGeometry(1, 0.72, 1, 16);
const CONE = new THREE.ConeGeometry(1, 1, 14);
const TORUS = new THREE.TorusGeometry(1, 0.42, 12, 28);

export function TreatModel({ kind }: { kind: TreatKind }) {
  switch (kind) {
    case 'caramelo': // bombón envuelto con lazos a los lados
      return (
        <group position-y={0.15}>
          <Part geometry={SPHERE} material={toon('#ff6b9a')} scale={[0.2, 0.15, 0.15]} shadow />
          {[-1, 1].map(s => (
            <Part key={s} geometry={CONE} material={toon('#ffd1e0')} position={[0.27 * s, 0, 0]} rotation-z={(s * Math.PI) / 2} scale={[0.11, 0.15, 0.11]} />
          ))}
        </group>
      );
    case 'galleta':
      return (
        <group position-y={0.03}>
          <Part geometry={CYL} material={toon('#dba56b')} scale={[0.24, 0.06, 0.24]} shadow />
          {[[0.08, 0.06], [-0.1, 0.03], [0.02, -0.11], [-0.04, 0.13], [0.13, -0.06]].map(([x, z], i) => (
            <mesh key={i} geometry={SPHERE} material={toon('#5b3a29')} position={[x, 0.035, z]} scale={[0.035, 0.02, 0.035]} />
          ))}
        </group>
      );
    case 'piruleta': // clavada en la hierba
      return (
        <group>
          <Part geometry={CYL} material={toon('#ffffff')} position-y={0.2} scale={[0.02, 0.4, 0.02]} />
          <group position-y={0.52} rotation-x={Math.PI / 2}>
            <Part geometry={CYL} material={toon('#ff8fc7')} scale={[0.2, 0.05, 0.2]} shadow />
            <mesh geometry={CYL} material={toon('#fff3a8')} scale={[0.12, 0.056, 0.12]} />
            <mesh geometry={CYL} material={toon('#9fd8ff')} scale={[0.05, 0.06, 0.05]} />
          </group>
        </group>
      );
    case 'dona':
      return (
        <group position-y={0.065} rotation-x={Math.PI / 2}>
          <Part geometry={TORUS} material={toon('#e0a96d')} scale={0.16} shadow />
          <mesh geometry={TORUS} material={toon('#ff7eb6')} position-z={-0.03} scale={[0.16, 0.16, 0.1]} />
          {[0, 1.3, 2.6, 3.9, 5.2].map((a, i) => (
            <mesh key={i} geometry={SPHERE} material={toon(['#fff3a8', '#9fd8ff', '#ffffff'][i % 3])}
              position={[Math.cos(a) * 0.16, Math.sin(a) * 0.16, -0.075]} scale={0.018} />
          ))}
        </group>
      );
    case 'cupcake':
      return (
        <group position-y={0.08}>
          <Part geometry={CUP} material={toon('#b9a2e8')} scale={[0.15, 0.16, 0.15]} shadow />
          <Part geometry={SPHERE} material={toon('#fff0f6')} position-y={0.11} scale={[0.17, 0.12, 0.17]} />
          <Part geometry={SPHERE} material={toon('#ff4d6d')} position-y={0.25} scale={0.045} />
        </group>
      );
  }
}
