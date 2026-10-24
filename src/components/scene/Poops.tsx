'use client';
import { useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { usePetStore } from '@/store/petStore';
import { visiblePoops } from '@/lib/petLogic';
import { POOP_XZ } from './nav';
import { Part, toon } from './toon';

const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const TIP = new THREE.ConeGeometry(1, 1, 16);
const BROWN = toon('#8a5a32');
const FLY = new THREE.MeshBasicMaterial({ color: '#2b2622' });
const WING = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 });
const HIT = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }); // zona de toque más grande que la caca

// Caca de dibujo: tres roscos apilados y la punta, con dos moscas dando vueltas. Se limpia tocándola.
function Poop({ spot }: { spot: number }) {
  const flies = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    flies.current.children.forEach((f, i) => {
      const a = t * (2.2 + i) + i * 3;
      f.position.set(Math.cos(a) * 0.35, 0.55 + Math.sin(t * 5 + i) * 0.08, Math.sin(a) * 0.35);
      f.rotation.y = -a;
    });
  });
  const onTap = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    navigator.vibrate?.(40);
    usePetStore.getState().act('clean', spot);
  };
  const [x, z] = POOP_XZ[spot];
  return (
    <group position={[x, 0, z]} rotation-y={spot * 1.3} scale={1.35} onClick={onTap}>
      <Part geometry={SPHERE} material={BROWN} position-y={0.08} scale={[0.26, 0.1, 0.26]} shadow />
      <Part geometry={SPHERE} material={BROWN} position-y={0.18} scale={[0.19, 0.085, 0.19]} shadow />
      <Part geometry={SPHERE} material={BROWN} position-y={0.27} scale={[0.12, 0.07, 0.12]} />
      <Part geometry={TIP} material={BROWN} position={[0.02, 0.35, 0]} rotation-z={-0.3} scale={[0.06, 0.12, 0.06]} />
      <mesh geometry={SPHERE} material={HIT} position-y={0.25} scale={0.5} />
      <group ref={flies}>
        {[0, 1].map(i => (
          <group key={i}>
            <mesh geometry={SPHERE} material={FLY} scale={0.03} />
            <mesh geometry={SPHERE} material={WING} position-y={0.03} scale={[0.045, 0.008, 0.02]} />
          </group>
        ))}
      </group>
    </group>
  );
}

/** Las cacas a la vista (salen 2 h después de comer). Mismo sitio en los dos móviles: viene del estado compartido. */
export default function Poops() {
  // Texto y no array: el selector solo vuelve a pintar cuando cambia qué cacas hay, no en cada tick.
  const spots = usePetStore(s => visiblePoops(s).map(p => p.spot).join(','));
  return <>{spots && spots.split(',').map(Number).map(spot => <Poop key={spot} spot={spot} />)}</>;
}
