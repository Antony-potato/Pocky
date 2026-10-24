'use client';
import { useEffect, useRef } from 'react';
import { Canvas, addAfterEffect, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import Island from './Island';
import Pocky, { pockyPos } from './Pocky';
import Poops from './Poops';
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

// iOS 26 desenfoca la franja de la hora y la tiñe con el fondo de html/body (no se puede quitar desde CSS).
// Le damos el color real del borde superior de la escena (con luz y tone mapping), no un hex fijo que no coincide.
function StatusTint({ onTint }: { onTint: (color: string) => void }) {
  const gl = useThree(s => s.gl);
  useEffect(() => {
    let last = -Infinity;
    // Tras pintar el frame, antes de que el navegador lo componga (sin preserveDrawingBuffer).
    return addAfterEffect(t => {
      if (t - last < 1500) return; // ponytail: readPixels sincroniza la GPU; 1 fila cada 1,5 s es despreciable
      last = t;
      const ctx = gl.getContext(), w = ctx.drawingBufferWidth, px = new Uint8Array(w * 4);
      const y = Math.max(0, ctx.drawingBufferHeight - 1 - Math.round(24 * gl.getPixelRatio())); // mitad de la franja de la hora
      ctx.readPixels(0, y, w, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
      onTint(`rgb(${Math.round(r / w)},${Math.round(g / w)},${Math.round(b / w)})`);
    });
  }, [gl, onTint]);
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

export default function World({ hour, onReady, onTint }: { hour: number; onReady?: () => void; onTint?: (color: string) => void }) {
  const ph = getTimePhase(hour);
  return (
    // Neutral: casi no toca los colores medios y suaviza las luces altas (tejado, arena, espuma) en vez de quemarlas.
    <Canvas shadows="percentage" orthographic dpr={[1, 2]} gl={{ toneMapping: THREE.NeutralToneMapping }}
      camera={{ position: OFFSET, zoom: 40, near: 0.1, far: 100 }}>
      <Lights hour={hour} />
      <Island waterColor={ph.water} sky={ph.sky} glow={ph.glow} />
      <Pocky />
      <Poops />
      <CameraRig />
      <FirstFrame onReady={onReady} />
      {onTint && <StatusTint onTint={onTint} />}
    </Canvas>
  );
}
