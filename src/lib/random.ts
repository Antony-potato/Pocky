/**
 * PRNG determinista (mulberry32).
 *
 * La decoración (estrellas, corazones) necesita posiciones dispersas pero
 * ESTABLES: con `Math.random()` en render, cada re-render las recolocaba —
 * las estrellas del modo noche saltaban cada vez que llegaba un snapshot.
 * Además `Math.random()` es impuro y React lo prohíbe en fase de render.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
