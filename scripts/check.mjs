// Checks mínimos de la lógica pura. Ejecutar: npm run check (Node >= 23, quita los tipos de .ts solo).
import assert from 'node:assert/strict';
import { NODES, findPath, nearestNode, WANDER, POI } from '../src/components/scene/nav.ts';
import { applyTick, applyAction, endActivity, syncedFields, computeAge, DEFAULT_PET } from '../src/lib/petLogic.ts';

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

// applyAction: misma función en local y en la transacción del servidor.
const base = { ...DEFAULT_PET, hunger: 50, lastUpdated: t0 };
const fed = applyAction(base, 'feed', t0);
assert.equal(fed.hunger, 65);
assert.equal(fed.activity, 'eating');
assert.equal(fed.totalCaresGiven, 1);
assert.equal(applyAction(fed, 'bathe', t0), null, 'ocupado comiendo: no se puede bañar a la vez');
assert.equal(applyAction({ ...base, energy: 5 }, 'play', t0), null, 'sin energía no juega');
const slept = applyAction(base, 'sleep', t0);
assert.equal(slept.mood, 'sleeping');
assert.equal(applyAction(slept, 'feed', t0), null, 'dormido no come');
const woke2 = applyAction(slept, 'wake', t0);
assert.equal(woke2.energy, Math.min(100, base.energy + 30));
assert.equal(applyAction(woke2, 'wake', t0), null, 'dos móviles pulsando despertar no suman energía dos veces');

// endActivity: solo cierra la actividad si sigue siendo la misma.
assert.equal(endActivity(fed, 'eating').activity, 'idle');
assert.equal(endActivity(fed, 'bathing'), null);

// syncedFields: nunca escribe nombre, fecha de nacimiento ni tokens.
const fields = syncedFields({ ...fed, fcmTokens: ['x'] });
assert.ok(!('createdAt' in fields) && !('fcmTokens' in fields) && !('name' in fields));

// computeAge: días de calendario (nació ayer a las 23:00 → hoy cuenta 1).
const at = (d, h) => new Date(2026, 9, d, h).getTime();
assert.equal(computeAge(at(9, 23), at(10, 8)), 1);
assert.equal(computeAge(at(10, 1), at(10, 23)), 0);
assert.equal(computeAge(at(1, 12), at(10, 12)), 9);

console.log('ok');
