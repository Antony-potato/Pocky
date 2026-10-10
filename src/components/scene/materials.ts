import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Materiales y geometrías "orgánicas" de la isla: MeshStandardMaterial con un poco de GLSL inyectado
// (siguen recibiendo luces, sombras y tone mapping como el resto) y esferas con lóbulos para la vegetación.

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reloj compartido por los shaders animados (agua). Lo avanza Island en useFrame.
export const uTime = { value: 0 };

const NOISE = /* glsl */ `
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + 1.), f.x), f.y);
}`;

type Patch = {
  key: string; // único por variante de GLSL (three cachea el programa por esta clave)
  uniforms?: Record<string, THREE.IUniform>;
  head?: string; // declaraciones/funciones del fragment
  color?: string; // retoca diffuseColor
  normal?: string; // retoca `normal` (espacio de vista)
  light?: string; // retoca outgoingLight
  vhead?: string; // declaraciones del vertex (atributos, uniforms, funciones)
  vertex?: string; // retoca `transformed` (posición local) antes de proyectar; con él, el vertex también tiene el ruido
};

// En el fragment hay vW (posición en el mundo) y vL (posición local, antes del instancing).
export function shaded(params: THREE.MeshStandardMaterialParameters, p: Patch) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, p.uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vW;\nvarying vec3 vL;\n${p.vertex ? NOISE : ''}\n${p.vhead ?? ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n{${p.vertex ?? ''}}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vL = transformed;
        vec4 wq = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
          wq = instanceMatrix * wq;
        #endif
        vW = (modelMatrix * wq).xyz;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vW;\nvarying vec3 vL;\n${NOISE}\n${p.head ?? ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n{${p.color ?? ''}}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n{${p.normal ?? ''}}`)
      .replace('#include <opaque_fragment>', `{${p.light ?? ''}}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => p.key;
  return m;
}

// Variación suave de tono en el mundo: rompe el color plano sin que se vea una textura.
export const VARY = 'diffuseColor.rgb *= .93 + .14 * vnoise(vW.xz * 3.1 + vW.y * 2.3);';

// Esfera con lóbulos (base de cada mata de copas y arbustos, ver foliage() en shapes.ts): domos repartidos por la superficie que se solapan
// y dejan pliegues entre ellos; normales suaves, así no se ve el facetado de la malla.
export function blob(seed: number, lobes: number, amp: number, detail = 5) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const r = rng(seed), golden = Math.PI * (3 - Math.sqrt(5));
  const dirs = Array.from({ length: lobes }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / lobes, rad = Math.sqrt(1 - y * y), th = i * golden + r() * 0.8;
    return new THREE.Vector3(Math.cos(th) * rad, y + (r() - 0.5) * 0.2, Math.sin(th) * rad).normalize();
  });
  const cap = Math.acos(1 - 2 / lobes) * 1.4;
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let k = 0;
    for (const d of dirs) {
      const a = Math.acos(Math.min(1, v.dot(d))) / cap;
      if (a < 1) k = Math.max(k, Math.sqrt(1 - a * a));
    }
    v.multiplyScalar(1 - amp + amp * k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Normales suaves para una ExtrudeGeometry (que trae normales planas por cara): el bisel se ve redondo.
// Las tapas se quedan mirando arriba/abajo para que sus triángulos largos no se manchen.
export function smoothSlab(g: THREE.BufferGeometry, top: number, bottom: number) {
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g);
  m.computeVertexNormals();
  const pos = m.attributes.position, nor = m.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (Math.abs(y - top) < 1e-3) nor.setXYZ(i, 0, 1, 0);
    else if (Math.abs(y - bottom) < 1e-3) nor.setXYZ(i, 0, -1, 0);
  }
  return m;
}
