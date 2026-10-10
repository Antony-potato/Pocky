'use client';
import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import Island from './Island';
import Pocky, { pockyPos } from './Pocky';
import { getTimePhase } from '@/lib/timeBackground';

const OFFSET: [number, number, number] = [0, 10, 12]; // cámara respecto al punto que mira: vista isométrica ~40°
const POLAR = Math.atan2(OFFSET[2], OFFSET[1]);

// Cámara ortográfica que sigue a Pocky. Un dedo gira la isla y el pellizco hace zoom.
function CameraRig() {
  const camera = useThree(s => s.camera);
  const size = useThree(s => s.size);
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const base = Math.min(size.width, size.height * 0.8);

  useEffect(() => {
    camera.zoom = base / 9.5;
    camera.updateProjectionMatrix();
  }, [camera, base]);

  useFrame((_, dt) => {
    if (!controls) return;
    const t = controls.target, k = 1 - Math.exp(-Math.min(dt, 0.1) * 2.5);
    const dx = (pockyPos.x - t.x) * k, dz = (pockyPos.z - t.z) * k;
    t.x += dx; t.z += dz;
    camera.position.x += dx; camera.position.z += dz;
  });

  return (
    <OrbitControls makeDefault enablePan={false} enableDamping rotateSpeed={0.6}
      minPolarAngle={POLAR} maxPolarAngle={POLAR} minZoom={base / 22} maxZoom={base / 4} />
  );
}

// Avisa tras el primer frame pintado (shaders compilados, escena visible) para cerrar la pantalla de carga.
function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; onReady?.(); } });
  return null;
}

// Fondo, cielo y sol según la hora. Sombras anchas y suaves (estilo maqueta de arcilla, no recortes duros).
export function Lights({ hour }: { hour: number }) {
  const ph = getTimePhase(hour);
  return (
    <>
      <color attach="background" args={[ph.water]} />
      <hemisphereLight color={ph.sky} groundColor={ph.ground} intensity={ph.hemiIntensity} />
      <directionalLight
        position={[7, 14, 8.5]} color={ph.sun} intensity={ph.sunIntensity} castShadow
        shadow-mapSize={[1024, 1024]} shadow-radius={6} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-left={-13} shadow-camera-right={13} shadow-camera-top={13} shadow-camera-bottom={-13}
        shadow-camera-near={1} shadow-camera-far={40}
      />
    </>
  );
}

export default function World({ hour, onReady }: { hour: number; onReady?: () => void }) {
  const ph = getTimePhase(hour);
  return (
    // Neutral: casi no toca los colores medios y suaviza las luces altas (tejado, arena, espuma) en vez de quemarlas.
    <Canvas shadows="percentage" orthographic dpr={[1, 2]} gl={{ toneMapping: THREE.NeutralToneMapping }}
      camera={{ position: OFFSET, zoom: 40, near: 0.1, far: 100 }}>
      <Lights hour={hour} />
      <Island waterColor={ph.water} sky={ph.sky} glow={ph.glow} />
      <Pocky />
      <CameraRig />
      <FirstFrame onReady={onReady} />
    </Canvas>
  );
}
