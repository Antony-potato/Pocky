// Checks mínimos de la lógica pura. Ejecutar: npm run check (Node >= 23, quita los tipos de .ts solo).
import assert from 'node:assert/strict';
import { NODES, findPath, nearestNode, WANDER, POI } from '../src/components/scene/nav.ts';
import { applyTick, DEFAULT_PET } from '../src/lib/petLogic.ts';

// Navegación: todos los destinos alcanzables desde el centro, y los caminos empiezan/acaban donde toca.
for (const to of [...WANDER, ...Object.values(POI).map(p => p.node)]) {
  const path = findPath('c', to);
  assert.equal(path[0], 'c', `camino a ${to} no empieza en c`);
  assert.equal(path.at(-1), to);
}
assert.deepEqual(findPath('s2', 'bowl'), ['s2', 's', 'field', 'play', 'bowl']); // más corto que pasar por el centro
assert.equal(nearestNode([7.4, -0.3]), 'bed');
assert.ok(Object.keys(NODES).length > 10);

// applyTick: una actividad atascada (app cerrada a mitad de acción) vuelve a 'idle'.
const t0 = Date.now();
const stuck = applyTick({ ...DEFAULT_PET, activity: 'eating', lastUpdated: t0 - 5 * 60000 }, t0);
assert.equal(stuck.activity, 'idle');

// applyTick: al despertarse solo (energía >= 95) el mood ya no es 'sleeping'.
const woke = applyTick({ ...DEFAULT_PET, isAsleep: true, activity: 'sleeping', energy: 94.9, lastUpdated: t0 - 60000 }, t0);
assert.equal(woke.isAsleep, false);
assert.notEqual(woke.mood, 'sleeping');
assert.equal(woke.activity, 'idle');

// applyTick: si sigue dormido, sigue durmiendo.
const asleep = applyTick({ ...DEFAULT_PET, isAsleep: true, activity: 'sleeping', energy: 20, lastUpdated: t0 - 60000 }, t0);
assert.equal(asleep.activity, 'sleeping');

console.log('ok');
