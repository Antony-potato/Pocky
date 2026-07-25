import { describe, it, expect } from 'vitest';
import {
  projectPet, baseFromProjection, applyDeltas, getMood, getNeeds,
  createDefaultPet, RATES, MAX_PROJECTION_MIN, ACTIONS, clamp,
} from './petLogic';
import { normalizeDoc } from './petDoc';
import { PetDoc, PetStats } from '@/types/pet';

const T0 = 1_700_000_000_000; // instante base arbitrario y estable
const MIN = 60_000;

function makeDoc(over: Partial<PetDoc> = {}): PetDoc {
  return { ...createDefaultPet(T0), ...over };
}

const statsOf = (p: PetStats): PetStats => ({
  hunger: p.hunger, happiness: p.happiness,
  cleanliness: p.cleanliness, energy: p.energy, health: p.health,
});

describe('projectPet — degradación despierto', () => {
  it('no cambia nada con 0 minutos transcurridos', () => {
    const base = makeDoc({ hunger: 50, happiness: 50, cleanliness: 50, energy: 50, health: 50 });
    const p = projectPet(base, T0);
    expect(statsOf(p)).toEqual({ hunger: 50, happiness: 50, cleanliness: 50, energy: 50, health: 50 });
  });

  it('aplica exactamente la tasa por minuto', () => {
    const base = makeDoc({ hunger: 100, happiness: 100, cleanliness: 100, energy: 100, health: 100 });
    const p = projectPet(base, T0 + 100 * MIN);
    expect(p.hunger).toBeCloseTo(100 - 100 * RATES.hunger, 6);
    expect(p.happiness).toBeCloseTo(100 - 100 * RATES.happiness, 6);
    expect(p.cleanliness).toBeCloseTo(100 - 100 * RATES.cleanliness, 6);
    expect(p.energy).toBeCloseTo(100 - 100 * RATES.energy, 6);
  });

  it('nunca baja de 0', () => {
    const base = makeDoc({ hunger: 5, happiness: 5, cleanliness: 5, energy: 5, health: 5 });
    const p = projectPet(base, T0 + 10_000 * MIN);
    expect(p.hunger).toBe(0);
    expect(p.happiness).toBe(0);
    expect(p.energy).toBe(0);
    expect(p.health).toBe(0);
  });

  it('un reloj atrasado no regenera stats (elapsed negativo → 0)', () => {
    const base = makeDoc({ hunger: 50, lastUpdated: T0 });
    const p = projectPet(base, T0 - 500 * MIN);
    expect(p.hunger).toBe(50);
    expect(p.happiness).toBe(base.happiness);
  });

  it('acota la proyección a 48 h aunque el documento sea muy viejo', () => {
    const base = makeDoc({ hunger: 100, happiness: 100, cleanliness: 100, energy: 100 });
    const at48h    = projectPet(base, T0 + MAX_PROJECTION_MIN * MIN);
    const atOneYear = projectPet(base, T0 + 525_600 * MIN);
    expect(statsOf(atOneYear)).toEqual(statsOf(at48h));
  });
});

describe('projectPet — sueño', () => {
  it('recupera energía a RATES.sleepRegen por minuto', () => {
    const base = makeDoc({ energy: 20, isAsleep: true, sleepStartedAt: T0 });
    const p = projectPet(base, T0 + 30 * MIN);
    expect(p.energy).toBeCloseTo(20 + 30 * RATES.sleepRegen, 6);
    expect(p.isAsleep).toBe(true);
  });

  it('congela felicidad y limpieza mientras duerme', () => {
    const base = makeDoc({ happiness: 60, cleanliness: 60, energy: 10, isAsleep: true });
    const p = projectPet(base, T0 + 60 * MIN);
    expect(p.happiness).toBe(60);
    expect(p.cleanliness).toBe(60);
  });

  it('se despierta solo al llegar a 100 y pasa a régimen despierto', () => {
    const base = makeDoc({ energy: 0, hunger: 100, isAsleep: true, sleepStartedAt: T0 });
    const minsToFull = 100 / RATES.sleepRegen;      // 125 min
    const extra = 75;
    const p = projectPet(base, T0 + (minsToFull + extra) * MIN);

    expect(p.isAsleep).toBe(false);
    expect(p.activity).toBe('idle');
    // energía: llena y luego se gasta durante `extra` minutos despierto
    expect(p.energy).toBeCloseTo(100 - extra * RATES.energy, 6);
    // hambre: tasa dormida durante minsToFull, tasa despierta después
    expect(p.hunger).toBeCloseTo(
      100 - minsToFull * RATES.hungerAsleep - extra * RATES.hunger, 6,
    );
  });

  it('reporta los minutos dormidos', () => {
    const base = makeDoc({ energy: 10, isAsleep: true, sleepStartedAt: T0 });
    const p = projectPet(base, T0 + 45 * MIN);
    expect(p.sleptMins).toBeCloseTo(45, 6);
  });
});

describe('REGRESIÓN — el bug del "de 0 a 40 sin que pase tiempo"', () => {
  it('dormir y despertar al instante no regala energía', () => {
    const awake = makeDoc({ energy: 8 });

    // El usuario pulsa Dormir: se ancla la proyección, energía intacta.
    const asleep: PetDoc = {
      ...awake,
      ...baseFromProjection(awake, projectPet(awake, T0)),
      isAsleep: true, sleepStartedAt: T0, lastUpdated: T0,
    };
    expect(asleep.energy).toBeCloseTo(8, 6);

    // Pulsa Despertar 1 segundo después: la energía sale de la proyección, sin bonus.
    const p = projectPet(asleep, T0 + 1000);
    expect(p.energy).toBeLessThan(8.1);
  });

  it('el ciclo dormir/despertar repetido 10 veces no acumula energía', () => {
    let doc = makeDoc({ energy: 8 });
    for (let i = 0; i < 10; i++) {
      const t = T0 + i * 1000;
      const sleeping = projectPet(doc, t);
      doc = { ...doc, ...baseFromProjection(doc, sleeping), isAsleep: true, sleepStartedAt: t, lastUpdated: t };
      const waking = projectPet(doc, t + 500);
      doc = { ...doc, ...baseFromProjection(doc, waking), isAsleep: false, sleepStartedAt: null, lastUpdated: t + 500 };
    }
    expect(doc.energy).toBeGreaterThan(7);
    expect(doc.energy).toBeLessThan(9); // antes del arreglo habría sido 100
  });

  it('dormir 30 minutos reales sí da energía proporcional', () => {
    const base = makeDoc({ energy: 8, isAsleep: true, sleepStartedAt: T0 });
    const p = projectPet(base, T0 + 30 * MIN);
    expect(p.energy).toBeCloseTo(8 + 30 * RATES.sleepRegen, 6);
  });
});

describe('projectPet — actividad', () => {
  it('mantiene la actividad mientras no expira', () => {
    const base = makeDoc({ activity: 'eating', activityUntil: T0 + 2500 });
    expect(projectPet(base, T0 + 1000).activity).toBe('eating');
  });

  it('vuelve a idle en cuanto expira, sin necesidad de escritura', () => {
    const base = makeDoc({ activity: 'eating', activityUntil: T0 + 2500 });
    expect(projectPet(base, T0 + 3000).activity).toBe('idle');
  });

  it('un documento heredado sin activityUntil no deja a Pocky bloqueado', () => {
    // Esquema viejo: quedó "comiendo" para siempre porque nadie escribió idle.
    const legacy = normalizeDoc({ ...createDefaultPet(T0), activity: 'eating', lastUpdated: T0 }, T0);
    expect(projectPet(legacy, T0 + 1000).activity).toBe('idle');
  });

  it('dormido siempre reporta actividad sleeping', () => {
    const base = makeDoc({ isAsleep: true, energy: 10, activity: 'eating', activityUntil: T0 + 999_999 });
    expect(projectPet(base, T0 + 1000).activity).toBe('sleeping');
  });
});

describe('projectPet — consistencia entre dispositivos', () => {
  it('el mismo documento y la misma hora dan el mismo resultado', () => {
    const base = makeDoc({ hunger: 63.2, happiness: 41.7, cleanliness: 88.1, energy: 55.5, health: 77 });
    const a = projectPet(base, T0 + 137 * MIN);
    const b = projectPet(base, T0 + 137 * MIN);
    expect(statsOf(a)).toEqual(statsOf(b));
    expect(a.mood).toBe(b.mood);
  });

  it('re-anclar a mitad de camino no altera el resultado final', () => {
    const base = makeDoc({ hunger: 90, happiness: 90, cleanliness: 90, energy: 90, health: 100 });

    const direct = projectPet(base, T0 + 600 * MIN);

    // El cron ancla a los 300 min y desde ahí se sigue proyectando.
    const mid = projectPet(base, T0 + 300 * MIN);
    const anchored: PetDoc = { ...base, ...baseFromProjection(base, mid), lastUpdated: T0 + 300 * MIN };
    const viaAnchor = projectPet(anchored, T0 + 600 * MIN);

    // Los cuatro stats lineales son exactamente idempotentes bajo re-anclaje.
    expect(viaAnchor.hunger).toBeCloseTo(direct.hunger, 6);
    expect(viaAnchor.happiness).toBeCloseTo(direct.happiness, 6);
    expect(viaAnchor.cleanliness).toBeCloseTo(direct.cleanliness, 6);
    expect(viaAnchor.energy).toBeCloseTo(direct.energy, 6);
  });
});

describe('getMood', () => {
  const s = (o: Partial<PetStats>): PetStats =>
    ({ hunger: 90, happiness: 90, cleanliness: 90, energy: 90, health: 100, ...o });

  it('dormido gana a todo lo demás', () => {
    expect(getMood(s({ health: 5 }), true)).toBe('sleeping');
  });
  it('salud baja → sick', () => {
    expect(getMood(s({ health: 20 }), false)).toBe('sick');
  });
  it('umbrales de promedio', () => {
    expect(getMood(s({}), false)).toBe('happy');
    expect(getMood(s({ hunger: 40, happiness: 60 }), false)).toBe('neutral');
    expect(getMood(s({ hunger: 20, happiness: 20, cleanliness: 40, energy: 40 }), false)).toBe('sad');
    expect(getMood(s({ hunger: 5, happiness: 5, cleanliness: 5, energy: 5 }), false)).toBe('sick');
  });
});

describe('getNeeds', () => {
  const full: PetStats = { hunger: 90, happiness: 90, cleanliness: 90, energy: 90, health: 100 };

  it('sin necesidades cuando todo está bien', () => {
    expect(getNeeds(full, false, 'Pocky')).toEqual([]);
  });

  it('avisa por salud baja — el caso que antes no se notificaba nunca', () => {
    const needs = getNeeds({ ...full, health: 15 }, false, 'Pocky');
    const health = needs.find(n => n.id === 'health');
    expect(health).toBeDefined();
    expect(health!.urgency).toBe('critical');
  });

  it('la salud se reporta primero', () => {
    const needs = getNeeds({ ...full, health: 10, hunger: 5 }, false, 'Pocky');
    expect(needs[0].id).toBe('health');
  });

  it('no pide dormir si ya está dormido', () => {
    expect(getNeeds({ ...full, energy: 5 }, true, 'Pocky').some(n => n.id === 'sleep')).toBe(false);
    expect(getNeeds({ ...full, energy: 5 }, false, 'Pocky').some(n => n.id === 'sleep')).toBe(true);
  });

  it('escala a critical bajo los umbrales', () => {
    expect(getNeeds({ ...full, hunger: 25 }, false, 'P')[0].urgency).toBe('high');
    expect(getNeeds({ ...full, hunger: 10 }, false, 'P')[0].urgency).toBe('critical');
  });
});

describe('applyDeltas', () => {
  const s: PetStats = { hunger: 50, happiness: 50, cleanliness: 50, energy: 50, health: 50 };

  it('suma y resta correctamente', () => {
    expect(applyDeltas(s, ACTIONS.feed.deltas).hunger).toBe(65);
    expect(applyDeltas(s, ACTIONS.walk.deltas).energy).toBe(40);
  });

  it('no desborda por arriba ni por abajo', () => {
    expect(applyDeltas({ ...s, hunger: 95 }, { hunger: +25 }).hunger).toBe(100);
    expect(applyDeltas({ ...s, energy: 3 }, { energy: -10 }).energy).toBe(0);
  });

  it('deja intactos los stats sin delta', () => {
    expect(applyDeltas(s, { hunger: +10 }).health).toBe(50);
  });
});

describe('normalizeDoc', () => {
  it('convierte un documento del esquema viejo', () => {
    const legacy = {
      name: 'Pocky', species: 'bunny',
      hunger: 40, happiness: 30, cleanliness: 20, energy: 10, health: 60,
      mood: 'sad', age: 0, needs: [{ id: 'hunger' }], isConnected: true, // basura derivada
      isAsleep: false, activity: 'bathing', lastUpdated: T0,
      createdAt: T0 - 86_400_000, totalCaresGiven: 7, lastSyncedBy: 'device_x',
    };
    const doc = normalizeDoc(legacy, T0);

    expect(doc.hunger).toBe(40);
    expect(doc.totalCaresGiven).toBe(7);
    expect(doc.activityUntil).toBe(0);      // la actividad colgada expira
    expect(doc.sleepStartedAt).toBeNull();
    expect(doc).not.toHaveProperty('mood');
    expect(doc).not.toHaveProperty('needs');
    expect(doc).not.toHaveProperty('isConnected');
  });

  it('acepta un Timestamp de Firestore en lastUpdated', () => {
    const doc = normalizeDoc({ lastUpdated: { toMillis: () => T0 } }, T0 + 999);
    expect(doc.lastUpdated).toBe(T0);
  });

  it('usa `now` si lastUpdated falta o es una escritura pendiente', () => {
    expect(normalizeDoc({ lastUpdated: null }, T0).lastUpdated).toBe(T0);
    expect(normalizeDoc({}, T0).lastUpdated).toBe(T0);
  });

  it('rechaza especies y actividades inválidas', () => {
    const doc = normalizeDoc({ species: 'dragon', activity: 'hackeando' }, T0);
    expect(doc.species).toBe('bunny');
    expect(doc.activity).toBe('idle');
  });

  it('acota stats fuera de rango', () => {
    const doc = normalizeDoc({ hunger: 9999, energy: -50 }, T0);
    expect(doc.hunger).toBe(100);
    expect(doc.energy).toBe(0);
  });
});

describe('clamp', () => {
  it('acota a [0,100] por defecto', () => {
    expect(clamp(-5)).toBe(0);
    expect(clamp(150)).toBe(100);
    expect(clamp(42)).toBe(42);
  });
});
