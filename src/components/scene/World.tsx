'use client';
import { useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
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

export default function World({ hour }: { hour: number }) {
  const ph = getTimePhase(hour);
  return (
    <Canvas shadows="percentage" orthographic flat dpr={[1, 2]} camera={{ position: OFFSET, zoom: 40, near: 0.1, far: 100 }}>
      <color attach="background" args={[ph.water]} />
      <hemisphereLight color={ph.sky} groundColor={ph.ground} intensity={ph.hemiIntensity} />
      <directionalLight
        position={[8, 14, 6]} color={ph.sun} intensity={ph.sunIntensity} castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-left={-13} shadow-camera-right={13} shadow-camera-top={13} shadow-camera-bottom={-13}
        shadow-camera-near={1} shadow-camera-far={40}
      />
      <Island waterColor={ph.water} glow={ph.glow} />
      <Pocky />
      <CameraRig />
    </Canvas>
  );
}
