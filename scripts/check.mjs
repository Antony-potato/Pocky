// Checks mínimos de la lógica pura. Ejecutar: npm run check (Node >= 23, quita los tipos de .ts solo).
import assert from 'node:assert/strict';
import { NODES, findPath, nearestNode, WANDER, POI, TREAT_SPOTS } from '../src/components/scene/nav.ts';
import { applyTick, applyAction, syncedFields, computeAge, DEFAULT_PET, cancunHour, cancunDay, isQuietHour } from '../src/lib/petLogic.ts';

// Hora de Cancún (UTC−5 todo el año), da igual la zona del móvil o del servidor.
const utc = (d, h, m = 0) => Date.UTC(2026, 9, d, h, m);
assert.equal(cancunHour(utc(24, 6, 30)), 1);          // 06:30 UTC = 01:30 en Cancún
assert.equal(cancunHour(utc(24, 5)), 0);              // medianoche: 0, no 24
assert.equal(cancunDay(utc(24, 3)), '2026-10-23');    // 03:00 UTC aún es "ayer" en Cancún
assert.ok(isQuietHour(utc(24, 4)) && isQuietHour(utc(24, 12, 59)), '23:00 y 7:59 en silencio');
assert.ok(!isQuietHour(utc(24, 13)) && !isQuietHour(utc(25, 3, 59)), '8:00 y 22:59 sí avisa');

// Navegación: todos los destinos alcanzables desde el centro, y los caminos empiezan/acaban donde toca.
for (const to of [...WANDER, ...Object.values(POI).map(p => p.node)]) {
  const path = findPath('c', to);
  assert.equal(path[0], 'c', `camino a ${to} no empieza en c`);
  assert.equal(path.at(-1), to);
}
assert.deepEqual(findPath('s2', 'bowl'), ['s2', 's', 'field', 'play', 'bowl']); // más corto que pasar por el centro
assert.equal(nearestNode([7.4, -0.3]), 'bed');
assert.ok(Object.keys(NODES).length > 10);
// Golosinas: los claros donde caen están lejos de la casa (x -7..-4, z -4.3..-1.7) y del estanque.
for (const id of TREAT_SPOTS) {
  const [x, z] = NODES[id];
  assert.ok(!(x > -7.5 && x < -3.5 && z > -4.8 && z < -1.2), `${id} demasiado cerca de la casa`);
  assert.ok(((x - 3.8) / 3.3) ** 2 + ((z - 3.4) / 2.4) ** 2 > 1, `${id} demasiado cerca del estanque`);
  assert.ok((x / 9.6) ** 2 + (z / 7.4) ** 2 < 0.75, `${id} demasiado cerca del borde`);
}

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
assert.equal(fed.hunger, 50, 'al empezar a comer aún no ha subido nada');
assert.equal(fed.activity, 'eating');
assert.equal(fed.totalCaresGiven, 1);
// Comer (20 s, +15) suma poco a poco y termina solo a su hora, aunque los ticks lleguen tarde.
const half = { ...fed, ...applyTick(fed, t0 + 10000) };
assert.ok(half.hunger > 57 && half.hunger < 58, `a mitad de comer va por la mitad (dio ${half.hunger})`);
assert.equal(half.activity, 'eating');
const done = { ...half, ...applyTick(half, t0 + 60000) };
assert.ok(done.hunger > 64 && done.hunger < 65, `al acabar ha sumado +15 en total (dio ${done.hunger})`);
assert.equal(done.activity, 'idle', 'la acción termina sola a su hora');
assert.equal(applyAction({ ...base, hunger: 95 }, 'feed', t0), null, 'lleno: no come');
assert.equal(applyAction({ ...base, energy: 95 }, 'sleep', t0), null, 'sin sueño: no duerme');
assert.equal(applyAction(fed, 'bathe', t0), null, 'ocupado comiendo: no se puede bañar a la vez');
assert.equal(applyAction(base, 'treat', t0).activity, 'snacking', 'la golosina es su propia actividad (no se ilumina con Alimentar)');
assert.equal(applyAction({ ...base, energy: 5 }, 'play', t0), null, 'sin energía no juega');
const slept = applyAction(base, 'sleep', t0);
assert.equal(slept.mood, 'sleeping');
assert.equal(applyAction(slept, 'feed', t0), null, 'dormido no come');
const woke2 = applyAction(slept, 'wake', t0);
assert.equal(woke2.energy, base.energy, 'despertar no regala energía (dormir/despertar en bucle llenaba la barra)');
// Dormido la energía sube poco a poco, también en ticks de menos de 1 min (la barra se ve subir).
const nap = applyTick({ ...slept, energy: 20 }, t0 + 20000);
assert.ok(Math.abs(nap.energy - 21) < 1e-9, `20 s dormido: +1 de energía (dio ${nap.energy})`);
assert.equal(applyAction(woke2, 'wake', t0), null, 'dos móviles pulsando despertar no suman energía dos veces');

// syncedFields: nunca escribe nombre, fecha de nacimiento ni tokens; sí la hora de fin de la acción.
const fields = syncedFields({ ...fed, fcmTokens: ['x'] });
assert.ok(!('createdAt' in fields) && !('fcmTokens' in fields) && !('name' in fields));
assert.equal(fields.activityUntil, t0 + 20000);

// computeAge: días de calendario (nació ayer a las 23:00 → hoy cuenta 1).
const at = (d, h) => new Date(2026, 9, d, h).getTime();
assert.equal(computeAge(at(9, 23), at(10, 8)), 1);
assert.equal(computeAge(at(10, 1), at(10, 23)), 0);
assert.equal(computeAge(at(1, 12), at(10, 12)), 9);

console.log('ok');
