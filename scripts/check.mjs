// Checks mínimos de la lógica pura. Ejecutar: npm run check (Node >= 23, quita los tipos de .ts solo).
import assert from 'node:assert/strict';
import { NODES, findPath, nearestNode, WANDER, POI, TREAT_SPOTS } from '../src/components/scene/nav.ts';
import { applyTick, applyAction, getNeeds, clamp, syncedFields, computeAge, currentStreak, partnerSummary, DEFAULT_PET, cancunHour, cancunDay, isQuietHour } from '../src/lib/petLogic.ts';

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
const t0 = utc(24, 17); // mediodía en Cancún: que no se metan las reglas de noche
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

// Mimos: +3, como mucho uno cada 30 s, también mientras come; dormido no.
const hug = applyAction(base, 'cuddle', t0);
assert.equal(hug.happiness, base.happiness + 3);
assert.equal(applyAction(hug, 'cuddle', t0 + 10000), null, 'mimos seguidos: solo cuenta uno cada 30 s');
assert.ok(applyAction(hug, 'cuddle', t0 + 30000), 'pasados 30 s vuelve a contar');
assert.equal(applyAction(fed, 'cuddle', t0 + 1000).activity, 'eating', 'el mimo no interrumpe la comida');
assert.equal(applyAction(slept, 'cuddle', t0), null, 'dormido no se entera');
assert.equal(hug.totalCaresGiven, base.totalCaresGiven, 'los mimos no cuentan como cuidado');

// Racha: días seguidos (Cancún) con algún cuidado; los mimos no cuentan.
const day1 = { ...base, lastUpdated: utc(24, 15) };                                       // 24 oct, 10:00 Cancún
const s1 = applyAction(day1, 'feed', utc(24, 15));
assert.deepEqual([s1.streak, s1.streakDay], [1, '2026-10-24']);
const s1b = applyAction({ ...s1, activity: 'idle' }, 'bathe', utc(25, 4));               // 23:00 del mismo día
assert.equal(s1b.streak, 1, 'el mismo día no suma');
const s2 = applyAction({ ...s1b, activity: 'idle' }, 'feed', utc(25, 14));               // 9:00 del 25 (a la 1:00 ya se habría dormido solo)
assert.equal(s2.streak, 2, 'día siguiente: +1');
assert.equal(currentStreak(s2, utc(26, 20)), 2, 'al día siguiente aún se ve (hay tiempo para cuidarlo)');
assert.equal(currentStreak(s2, utc(27, 6)), 0, 'un día entero sin cuidados: perdida');
assert.equal(applyAction({ ...s2, activity: 'idle' }, 'feed', utc(27, 15)).streak, 1, 'tras perderla vuelve a 1');
assert.equal(applyAction(s2, 'cuddle', utc(26, 15)).streakDay, '2026-10-25', 'los mimos no cuentan para la racha');

// Avisar al otro: resumen de lo que hizo la pareja, agrupado y sin spam.
const M = 60000;
const couple = { ...base, name: 'Pocky', devices: { a: { name: 'Ana', token: 'ta' }, b: { name: 'Leo', token: 'tb' }, a2: { name: 'Ana' } },
  log: [{ by: 'a', a: 'feed', t: t0 }, { by: 'a', a: 'bathe', t: t0 + 2 * M }, { by: 'a', a: 'cuddle', t: t0 + 3 * M }, { by: 'a', a: 'feed', t: t0 + 4 * M }] };
assert.equal(partnerSummary(couple, 'b', t0 + 6 * M), null, 'espera a que acabe la tanda (última hace < 5 min)');
assert.deepEqual(partnerSummary(couple, 'b', t0 + 10 * M), { title: 'Ana cuidó a Pocky', body: 'comida 🍖 y baño 🛁' }, 'sin repetidos ni mimos');
assert.equal(partnerSummary(couple, 'a', t0 + 10 * M), null, 'lo mío no me lo cuenta');
assert.equal(partnerSummary(couple, 'a2', t0 + 10 * M), null, 'ni lo de otro móvil con mi mismo nombre');
const told = { ...couple, devices: { ...couple.devices, b: { ...couple.devices.b, partnerSeen: t0 + 10 * M } } };
assert.equal(partnerSummary({ ...told, log: [...told.log, { by: 'a', a: 'play', t: t0 + 12 * M }] }, 'b', t0 + 20 * M), null, 'como mucho un resumen cada 30 min');
assert.equal(partnerSummary(couple, 'b', t0 + 7 * 60 * M), null, 'lo de hace más de 6 h ya no se cuenta');

// Medicina: solo con la salud baja; cura poco a poco; enfermo = necesidad crítica (la primera).
assert.equal(applyAction(base, 'medicine', t0), null, 'sano (salud 100): no quiere medicina');
const ill = { ...base, health: 20 };
assert.equal(getNeeds(ill)[0].id, 'medicine');
assert.equal(getNeeds(ill)[0].urgency, 'critical');
const healing = applyAction(ill, 'medicine', t0);
assert.equal(healing.activity, 'healing');
const healed = { ...healing, ...applyTick(healing, t0 + 20000) };
assert.ok(healed.health > 59.9 && healed.health < 60.1, `20 s de medicina: +40 de salud, más lo poco que sube sola (dio ${healed.health})`);
assert.equal(healed.activity, 'idle');

// Noche (Cancún): a la 1:00 se duerme solo; de noche no se despierta; a las 8 se levanta de malas si nadie lo acostó.
const awake = { ...base, energy: 50, lastUpdated: utc(25, 5, 45) };                       // 0:45
assert.equal(applyTick(awake, utc(25, 5, 59)).isAsleep, false, 'a las 0:59 aún no');
const alone = { ...awake, ...applyTick(awake, utc(25, 6)) };                               // 1:00
assert.ok(alone.isAsleep && alone.sleptAlone, 'a la 1:00 se duerme solo');
const at7 = { ...alone, ...applyTick(alone, utc(25, 12)) };                                // 7:00, energía llena
assert.ok(at7.isAsleep && at7.energy === 100, 'de noche no se despierta aunque tenga la energía llena');
const morning = { ...at7, ...applyTick(at7, utc(25, 13)) };                                // 8:00
assert.equal(morning.isAsleep, false);
assert.equal(morning.mood, 'grumpy', 'se durmió solo: se levanta de malas');
assert.equal(morning.grumpyWhy, 'alone');
assert.equal(morning.happiness, clamp(at7.happiness - 15));
assert.notEqual(applyAction(morning, 'cuddle', utc(25, 13, 5)).mood, 'grumpy', 'un mimo se lo quita');
const tucked = applyAction({ ...awake, lastUpdated: utc(25, 4) }, 'sleep', utc(25, 4));     // acostado a las 23:00
const tuckedMorning = { ...tucked, ...applyTick({ ...tucked, ...applyTick(tucked, utc(25, 12)) }, utc(25, 13)) };
assert.ok(!tuckedMorning.isAsleep && tuckedMorning.mood !== 'grumpy', 'si lo acostaron, a las 8 se levanta bien');
assert.equal(applyAction({ ...base, energy: 95, lastUpdated: utc(25, 4) }, 'sleep', utc(25, 4)).isAsleep, true, 'de noche se le puede acostar aunque no tenga sueño');
const woken = applyAction(at7, 'wake', utc(25, 12));
assert.deepEqual([woken.mood, woken.grumpyWhy], ['grumpy', 'woken'], 'despertarlo de noche: de malas');
assert.equal(applyTick(woken, utc(25, 12, 15)).isAsleep, false, 'desvelado: no se vuelve a dormir solo enseguida');

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
