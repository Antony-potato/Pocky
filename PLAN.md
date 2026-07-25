# Plan de corrección — Manejo de estado y sincronización

> Validación del análisis previo ([ANALISIS.md](ANALISIS.md)), diagnóstico de los bugs reportados en producción y plan de implementación detallado.
> Fecha: 2026-07-25 · Commit base: `4253317`

---

## 1. Validación del análisis previo

Se re-verificó cada hallazgo crítico de `ANALISIS.md` contra el código. **Todos se sostienen.** Además, los bugs que ustedes están viviendo en producción son evidencia directa de tres de ellos:

| Hallazgo | Estado | Evidencia |
|----------|--------|-----------|
| C-1 Deadlock de actividad | ✅ Confirmado | `setTimeout` local + guarda `activity !== 'idle'` en `petStore.ts:111` + `applyTick` solo resetea con `energy >= 95` |
| C-2 Cron diario | ✅ Confirmado | `vercel.json` → `0 0 * * *` |
| C-3 Permiso sin gesto | ✅ Confirmado | `PetScreen.tsx:80` pide permiso en `useEffect` de montaje |
| C-4 Fallback Web Push inalcanzable | ✅ Confirmado (con matiz) | Un solo `try` envuelve FCM y Web Push en `messaging.ts:13-74`. Matiz: en algunas versiones de Safari `getToken()` podría no lanzar; el defecto estructural (un fallo de FCM mata el fallback) se mantiene igual |
| C-5 `setVapidDetails` a nivel de módulo | ✅ Confirmado | `route.ts:24-28` con `\|\| ''` |
| C-6 Firestore sin auth | ✅ Confirmado | `firestore.rules:7` `allow read: if true` |
| C-7 Race en tokens | ✅ Confirmado | read-modify-write desde estado Zustand, no desde Firestore |
| A-4 Degradación doble / divergencia | ✅ Confirmado y **ampliado** | Es la causa de "ella ve un valor y yo otro" — ver §2.1 |
| A-5 Exploit energía +30 | ✅ Confirmado y **es exactamente el bug del 0→40** | Ver §2.3 |

**Cambio de prioridades respecto a ANALISIS.md:** los síntomas reportados demuestran que el modelo de estado es el dolor real de los usuarios hoy. Este plan pone el refactor de estado en la Fase 1 (antes iba repartido entre sprints 2 y 4). C-1 se absorbe dentro de ese refactor (`activityUntil`).

---

## 2. Diagnóstico de los síntomas reportados

### 2.1 · "Ella ve un valor y yo veo uno distinto"

**Causa raíz: cada dispositivo mantiene su propia proyección mutada del estado, y ninguna de las dos es la del documento compartido.**

El flujo actual tiene tres fuentes de verdad compitiendo:

1. **El documento de Firestore** — estado base, `lastUpdated` de la última escritura.
2. **La copia local del dispositivo A** — mutada cada 20 s por `tick()` (`petStore.ts:257-265`), que degrada stats y avanza `lastUpdated` **solo en memoria**.
3. **La copia local del dispositivo B** — igual, pero con su propio timer, su propia fase de arranque y su propio reloj.

Tres mecanismos concretos hacen que las pantallas nunca coincidan:

**a) El snapshot entrega el estado base sin proyectar** — `petStore.ts:98-102`:

```ts
const data = snap.data() as PetData;
set({ ...data, needs: getNeeds(data), isConnected: true });
```

Al recibir cualquier escritura remota, la UI **salta a los valores crudos guardados en la BD** (válidos al momento de `lastUpdated`, no al momento actual), y ahí se queda hasta el siguiente `tick()` local — hasta 20 segundos después — cuando vuelven a caer de golpe. Resultado visible: los números rebotan (bajan → suben al valor base → vuelven a bajar) cada vez que la otra persona hace algo.

**b) Los timers tienen fases distintas y iOS los congela.** El `setInterval` de 20 s (`PetScreen.tsx:89`) arranca cuando cada quien abre la app, así que A y B nunca proyectan en el mismo instante. Peor: cuando la PWA pasa a segundo plano, **iOS suspende el JavaScript** — timers y socket de Firestore incluidos. Al volver a la app, la pantalla muestra los valores congelados de la última vez que estuvo activa, hasta 20 s (primer tick) después. No hay listener de `visibilitychange` que fuerce un refresco al volver.

**c) Cada teléfono usa su propio reloj** (`petLogic.ts:31`, `Date.now()`). Cualquier desviación entre los dos dispositivos se traduce directamente en stats distintos, y la desviación se **persiste** cuando uno de los dos ejecuta una acción.

### 2.2 · "A veces se sobreescriben"

**Causa raíz: cada acción escribe el estado COMPLETO proyectado localmente, sin transacción — last-writer-wins.**

`feed` (`petStore.ts:109-129`, e igual las demás acciones):

```ts
const s = get();                              // copia LOCAL (proyectada por este dispositivo)
const realState = { ...s, ...applyTick(s) };  // + degradación calculada con reloj LOCAL
const next = { ...realState, hunger, ... };
get().sync(next);                             // ← escribe TODO el estado a la BD
```

Escenarios de pérdida real:

- **Acciones cruzadas:** A alimenta a las 12:00:00, B baña a las 12:00:02. La escritura de B se basó en su copia local (que aún no incluía la comida de A) y escribe *todos* los campos → **la comida de A se pierde**. No hay `runTransaction` en ningún punto del código.
- **App resucitada de background:** iOS congela la app de A con estado de hace 3 h. A la reabre y toca un botón en los primeros segundos → sincroniza un estado calculado sobre una foto de hace 3 h, pisando todo lo que B y el cron hicieron en medio.
- **Cola offline:** `firebase.ts:25` activa `persistentLocalCache()`. Las escrituras hechas sin conexión **se encolan y se aplican al reconectar**, con los valores viejos de cuando se hicieron — horas después pueden aterrizar encima del estado actual.
- **`totalCaresGiven: realState.totalCaresGiven + 1`** — contador leído-modificado-escrito: los cuidados simultáneos se pierden (debería ser `increment(1)`).
- Bonus: el indicador verde de conexión miente — con caché persistente, `onSnapshot` sigue entregando snapshots desde caché estando offline, así que `isConnected` queda en `true` sin red. Nunca se consulta `snapshot.metadata.fromCache`.

### 2.3 · "Le da sueño, ella lo desmarca y pasa de 0 a 40 sin que pase tiempo"

**Causa raíz exacta: `petStore.ts:244` regala +30 de energía fijos al despertar, sin validar cuánto durmió.**

```ts
wakeUp: () => {
  const s = get();
  const realState = { ...s, ...applyTick(s) };   // si durmió < 1 min, applyTick devuelve {} → sin cambio
  const energy = clamp(realState.energy + 30);   // ← +30 SIEMPRE
  ...
}
```

Secuencia reproducida: energía ~8-10 → aparece la alerta "tiene sueño" → ella pulsa Dormir → pulsa Despertar para quitar la alerta → `applyTick` devuelve `{}` (pasó menos de 1 minuto, `petLogic.ts:32`) → energía = 8 + 30 = **38 ≈ "de 0 a 40"**. Coincide al punto con lo que describes.

Agravantes:

- `wakeUp` no valida `isAsleep` — no tiene ninguna guarda.
- El ciclo es repetible sin límite: dormir→despertar→dormir→despertar = energía infinita (y con ella, felicidad y salud infinitas vía Jugar/Pasear). La economía del juego no existe mientras esto siga.
- La regeneración real por sueño (+0,39/min, `petLogic.ts:42`) es tan lenta (~4,3 h para llenar de 0 a 100) que el +30 instantáneo se convirtió, de facto, en la única forma práctica de recuperar energía — el exploit es más eficiente que jugar bien.

### 2.4 · Hallazgos nuevos de esta pasada (no estaban en ANALISIS.md)

| ID | Hallazgo | Archivo |
|----|----------|---------|
| E-1 | El snapshot pinta estado base sin proyectar → rebote visual de valores | `petStore.ts:98` |
| E-2 | Sin listener de `visibilitychange` → hasta 20 s de valores congelados al volver de background | `PetScreen.tsx:77-92` |
| E-3 | Cero uso de `runTransaction` → toda acción es un lost-update en potencia | `petStore.ts` completo |
| E-4 | `totalCaresGiven` sin `increment()` → cuidados simultáneos se pierden | `petStore.ts:124` |
| E-5 | Auto-despertar (`energy >= 95`) ocurre solo en el tick local y nunca se sincroniza → un dispositivo ve a Pocky despierto y el otro dormido | `petLogic.ts:55`, `petStore.ts:263` |
| E-6 | Guardas de acción evaluadas contra estado local → puedo "alimentar" a un Pocky que la otra persona acaba de dormir | `petStore.ts:111` |
| E-7 | `isConnected` ignora `snapshot.metadata.fromCache` → punto verde estando offline | `petStore.ts:101` |
| E-8 | `DEFAULT_PET.createdAt` se evalúa al cargar el módulo; si dos dispositivos crean el doc a la vez hay carrera y la edad se resetea | `petLogic.ts:73`, `petStore.ts:92` |
| E-9 | Escrituras offline encoladas por `persistentLocalCache` aterrizan tarde y pisan estado fresco | `firebase.ts:25` |

---

## 3. Arquitectura objetivo

### 3.1 Principio rector

> **El documento de Firestore guarda únicamente el estado base en un instante T. Todo lo que se ve en pantalla es una proyección pura de (estado base, hora actual). Toda escritura es una transacción sobre el estado fresco.**

Esto es el patrón estándar para estado compartido con degradación temporal (el mismo que usan los juegos idle bien hechos): la BD nunca guarda valores "en vivo", guarda un punto de anclaje; el tiempo hace el resto de forma determinista e idéntica en todos los clientes.

```
              ┌────────────────────────────────────────────┐
              │ Firestore: pets/pocky                      │
              │  { statsBase, lastUpdated(server), isAsleep,│
              │    activity, activityUntil, ... }           │
              └───────▲────────────────────┬───────────────┘
        runTransaction│                    │ onSnapshot (espejo, sin mutación)
                      │                    ▼
              ┌───────┴────────┐   ┌──────────────────┐
              │ Acción usuario │   │ store.remote      │  ← única copia del doc
              └────────────────┘   │ store.now         │  ← reloj (interval + visibilitychange)
                                   └────────┬──────────┘
                                            ▼
                                   projectPet(remote, now)   ← función PURA
                                            ▼
                                       UI (idéntica en A y B)
```

**Por qué esto arregla cada síntoma:**

| Síntoma | Qué lo elimina |
|---------|----------------|
| Valores distintos entre teléfonos | Misma entrada (doc compartido) + misma función pura + hora de pared ≈ misma salida. Nada que divergir: no hay copia local mutada |
| Rebote de valores al recibir escrituras | El snapshot ya no pinta el estado base: siempre se pinta la proyección al instante actual |
| Sobrescrituras | `runTransaction` lee el doc fresco dentro de la transacción; dos acciones simultáneas se serializan, ninguna se pierde |
| 0→40 de energía | La energía deja de ser un bonus por pulsar un botón: es función del tiempo dormido, calculada por la proyección |
| Deadlock de actividad (C-1) | La actividad se deriva de `activityUntil` vs reloj; expira sola en todos los dispositivos sin `setTimeout` |
| Valores congelados al volver de background | `visibilitychange` refresca `now` al instante |

### 3.2 Decisiones de arquitectura (y qué se descartó)

| Decisión | Alternativa descartada | Razón |
|----------|------------------------|-------|
| Proyección en render + transacciones cliente | Event sourcing / CRDT | Sobreingeniería para 2 usuarios y 1 documento. La transacción de Firestore ya da la serialización que se necesita |
| Transacciones desde el cliente | API route `/api/action` con Admin SDK | Menos latencia, funciona con la UI optimista de Firestore, y no añade una función serverless por acción. Si algún día importa el anti-cheat real, migrar acciones al servidor es el paso natural (la tabla `ACTIONS` ya quedará aislada para ello) |
| `lastUpdated` = `serverTimestamp()` | Reloj del cliente | Elimina el reloj del teléfono como fuente de verdad persistida. El cliente solo usa su reloj para *pintar*, acotado con clamp |
| Acciones deshabilitadas offline | Cola offline con reconciliación | `runTransaction` requiere conexión por diseño — es la semántica honesta: no puedes cuidar a una mascota compartida sin ver su estado real. La lectura offline (ver el estado) se mantiene |
| Tabla declarativa `ACTIONS` | 5 métodos duplicados | Una sola implementación transaccional; balancear el juego = editar una tabla |

### 3.3 Cambios de modelo de datos

```ts
// types/pet.ts — nuevo esquema del documento
export interface PetDoc {
  name: string;
  species: PetSpecies;
  // Stats BASE, válidos exactamente en lastUpdated (nunca proyectados):
  hunger: number; happiness: number; cleanliness: number;
  energy: number; health: number;
  isAsleep: boolean;
  sleepStartedAt: number | null;   // para UI "durmiendo desde hace X"
  activity: PetActivity;           // solo tiene sentido si now < activityUntil
  activityUntil: number;           // ← reemplaza los setTimeout sincronizados
  lastUpdated: Timestamp;          // ← serverTimestamp(), ya no Date.now() del cliente
  createdAt: number;
  totalCaresGiven: number;         // ← solo via increment(1)
  lastSyncedBy: string;
  lastCareBy?: string;             // para el feed "Ana cuidó a Pocky"
  lastCareAt?: number;
  lastNotificationSent?: number;
}
// mood, needs, age: SIEMPRE derivados; se eliminan del documento.
// fcmTokens / webPushSubscriptions: migran a subcolección (Fase 3).
```

Se eliminan del doc: `mood` (derivado), `age` (muerto), `needs`/`isConnected` (basura de UI que hoy se cuela, A-1).

---

## 4. Plan de implementación por fases

### FASE 1 — Refactor del modelo de estado 🎯 *arregla los 3 bugs reportados*

> Estimación total: ~2 días. Todo en local hasta T1.9; se despliega completo con la migración.

#### T1.1 · Proyección pura en `petLogic.ts` (~3 h)

Nueva función central, sin efectos secundarios, compartida por cliente y cron:

```ts
const MAX_PROJECTION_MIN = 60 * 48; // clamp defensivo: relojes rotos / docs antiguos

export function projectPet(base: PetDoc, now: number): ProjectedPet {
  const mins = Math.min(Math.max((now - toMillis(base.lastUpdated)) / 60000, 0), MAX_PROJECTION_MIN);
  //                     └─ nunca negativo (reloj atrasado) ─┘  └─ nunca gigante ─┘
  let { hunger, happiness, cleanliness, energy, health } = base;

  if (base.isAsleep) {
    energy = clamp(energy + mins * RATES.sleepRegen);
    hunger = clamp(hunger - mins * RATES.hungerAsleep);
  } else {
    hunger      = clamp(hunger      - mins * RATES.hunger);
    happiness   = clamp(happiness   - mins * RATES.happiness);
    cleanliness = clamp(cleanliness - mins * RATES.cleanliness);
    energy      = clamp(energy      - mins * RATES.energy);
  }
  const lowCount = [hunger, happiness, cleanliness].filter(v => v < 20).length;
  health = clamp(health + mins * (lowCount >= 2 ? -RATES.healthDrop : RATES.healthRegen));

  const isAsleep = base.isAsleep && energy < 100;          // auto-despertar derivado, igual en todos lados
  const activity: PetActivity =
    isAsleep ? 'sleeping'
    : (base.activityUntil > now ? base.activity : 'idle'); // ← mata C-1 de raíz

  const stats = { hunger, happiness, cleanliness, energy, health };
  return { ...stats, isAsleep, activity, mood: getMood({ ...base, ...stats, isAsleep }), needs: getNeeds(...) };
}
```

`applyTick` desaparece (el cron pasará a usar `projectPet` + escritura del resultado como nueva base). Rebalanceo incluido en la tabla `RATES`:

```ts
export const RATES = {
  hunger: 0.045, happiness: 0.055, cleanliness: 0.035, energy: 0.05,   // ~30-48 h de autonomía
  sleepRegen: 0.8,       // sueño completo en ~2 h (antes 4,3 h — con el +30 eliminado debe ser viable dormir de verdad)
  hungerAsleep: 0.02, healthDrop: 0.2, healthRegen: 0.1,
} as const;
```

**Criterio de aceptación:** suite de tests unitarios (T1.8) en verde; `projectPet(base, t)` es idempotente y monótona: proyectar a `t1` y luego re-proyectar la misma base a `t2` da lo mismo que proyectar directo a `t2`.

#### T1.2 · Store como espejo + reloj, sin mutación (~2 h)

```ts
interface PetStore {
  remote: PetDoc | null;        // SOLO lo escribe onSnapshot
  now: number;                  // SOLO lo escribe el reloj
  online: boolean;              // derivado de metadata.fromCache (arregla E-7)
  pending: PetActionId | null;  // feedback de acción en vuelo
  // ...acciones
}

// El "tick" ya no muta stats: solo mueve el reloj → re-render → re-proyección
const tickClock = () => usePetStore.setState({ now: Date.now() });

// Selector único de lectura para toda la UI:
export const useProjectedPet = () =>
  usePetStore(useShallow(s => (s.remote ? projectPet(s.remote, s.now) : null)));
```

`startListening` pasa a:

```ts
onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
  if (!snap.exists()) { get().initPet(); return; }   // create-if-missing transaccional (E-8)
  set({
    remote: normalizeDoc(snap.data()),               // tolera Timestamp | number (migración)
    online: !snap.metadata.fromCache,
    now: Date.now(),                                  // proyectar YA, sin esperar al intervalo (E-1)
  });
});
```

**Criterio de aceptación:** dos navegadores lado a lado muestran los mismos valores (±1 punto por redondeo de fase de reloj) en todo momento, sin interactuar, durante 10+ minutos. Al hacer una acción en uno, el otro converge en <2 s **sin rebote** (los valores nunca suben solos salvo acción/sueño).

#### T1.3 · Refresco en `visibilitychange` y `focus` (~30 min)

```ts
useEffect(() => {
  const wake = () => { if (document.visibilityState === 'visible') tickClock(); };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('pageshow', wake);   // iOS bfcache
  return () => { /* remove */ };
}, []);
```

El intervalo puede bajar a 10 s (ahora es baratísimo: solo actualiza un número; con los selectores de T1.2 no re-renderiza nada pesado innecesariamente).

**Criterio de aceptación:** enviar la PWA a background 1 h, volver → valores correctos en <1 s, sin ventana de 20 s congelada (E-2).

#### T1.4 · Acciones como transacciones con tabla declarativa (~3-4 h)

Elimina las 5 implementaciones duplicadas (A-2), el last-writer-wins (§2.2) y las guardas sobre estado rancio (E-6):

```ts
export const ACTIONS = {
  feed:  { activity: 'eating',  durationMs: 2500, deltas: { hunger: +15, happiness: +5 } },
  treat: { activity: 'eating',  durationMs: 2500, deltas: { hunger: +25, happiness: +10 } },
  bathe: { activity: 'bathing', durationMs: 3000, deltas: { cleanliness: +40, health: +5 } },
  walk:  { activity: 'walking', durationMs: 4000, deltas: { happiness: +20, energy: -10, health: +5, hunger: -5 }, minEnergy: 15 },
  play:  { activity: 'playing', durationMs: 3000, deltas: { happiness: +15, energy: -8, hunger: -5 }, minEnergy: 10 },
} as const satisfies Record<string, ActionSpec>;

perform: async (id: PetActionId) => {
  const spec = ACTIONS[id];
  set({ pending: id });
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(petRef);                       // ← estado FRESCO, no la copia local
      const base = normalizeDoc(snap.data());
      const now = Date.now();
      const p = projectPet(base, now);
      if (p.isAsleep || p.activity !== 'idle') throw new ActionRejected('busy');
      if (spec.minEnergy && p.energy < spec.minEnergy) throw new ActionRejected('tired');

      tx.update(petRef, {
        ...applyDeltas(p, spec.deltas),                        // nueva BASE = proyección + deltas
        activity: spec.activity,
        activityUntil: now + spec.durationMs,
        isAsleep: false,
        lastUpdated: serverTimestamp(),
        totalCaresGiven: increment(1),                         // E-4
        lastSyncedBy: getDeviceId(),
        lastCareBy: getDeviceId(), lastCareAt: now,
      });
    });
  } catch (e) {
    if (e instanceof ActionRejected) toast(MSG[e.reason]);     // A-11: el error deja de ser invisible
    else toast('Sin conexión — inténtalo de nuevo');           // transacción offline falla: correcto por diseño
  } finally {
    set({ pending: null });
  }
},
```

Desaparecen **todos** los `setTimeout` de sincronización (C-1, R-3): la actividad expira sola vía `activityUntil` en la proyección. Se elimina también `sync()` genérico — ya nadie escribe estado completo (A-1 resuelto por construcción: los campos escritos son una lista explícita).

**Criterios de aceptación:**
- Pulsar Alimentar en A y Bañar en B con <1 s de diferencia → **ambas** se aplican (`totalCaresGiven` sube 2, los dos deltas presentes).
- Matar la app a mitad de una actividad → a los `durationMs` los botones reviven solos en ambos dispositivos. El deadlock C-1 es irreproducible.
- Acción sin conexión → toast claro, estado intacto, nada encolado que pise después (E-9).

#### T1.5 · Dormir / despertar por tiempo real — *el bug del 0→40* (~1 h)

```ts
sleep: () => transaccion(tx => {
  const p = projectPet(base, now);
  if (p.isAsleep || p.activity !== 'idle') throw new ActionRejected('busy');
  if (p.energy >= 90) throw new ActionRejected('not-tired');
  tx.update(petRef, { ...toBase(p), isAsleep: true, sleepStartedAt: now, activityUntil: 0, lastUpdated: serverTimestamp() });
}),

wake: () => transaccion(tx => {
  const base = normalizeDoc(snap.data());
  if (!base.isAsleep) throw new ActionRejected('not-asleep');   // guarda que nunca existió
  const p = projectPet(base, now);                              // energía YA incluye lo dormido (0,8/min)
  tx.update(petRef, { ...toBase(p), isAsleep: false, sleepStartedAt: null, lastUpdated: serverTimestamp() });
  // SIN bonus. Cero. La energía es función del tiempo, punto.
}),
```

UI acompañante: mientras duerme, mostrar progreso ("💤 recuperando energía — 62%") para que quede claro que despertarlo temprano no regala nada.

**Criterio de aceptación:** Dormir → Despertar inmediato repetido 10 veces → la energía varía < 1 punto en total. Dormir 30 min reales → +24 de energía (0,8 × 30). El salto 0→40 es irreproducible.

#### T1.6 · Timestamps de servidor + normalización (~1 h)

- `lastUpdated: serverTimestamp()` en toda escritura (transacciones y cron).
- `normalizeDoc()` tolera `number | Timestamp` para leer documentos pre-migración.
- El clamp `[0, 48 h]` de T1.1 cubre la desviación de reloj del cliente al *pintar*; la desviación ya no puede *persistirse* (era el vector de A-3).

#### T1.7 · Simplificar `PetScreen` con el nuevo store (~2 h)

- Toda la UI lee de `useProjectedPet()` (selector con `useShallow`) → resuelve R-1.
- `useMemo` para las estrellas (R-2) y el array de acciones (R-4).
- Botones usan `pending` para feedback inmediato de la transacción en vuelo.
- Indicador de conexión usa `online` real (E-7).

#### T1.8 · Tests unitarios de la lógica pura (~2 h)

Vitest, sin emulador (funciones puras):

```
projectPet: degradación exacta por tasa · clamps 0/100 · elapsed negativo → 0 ·
elapsed > 48h → clamp · regen dormido · auto-despertar a 100 · actividad expira
por activityUntil · idempotencia (proyectar 2 veces = 1 vez) · getMood umbrales ·
getNeeds umbrales (incluida salud, tarea F2) · applyDeltas no desborda
```

Script `npm test` + type-check en `npm run build`. Es la red de seguridad para todo el rebalanceo posterior.

#### T1.9 · Migración del documento existente (~1 h)

Script único `scripts/migrate.mjs` (Admin SDK, se corre una vez antes del deploy):

1. Leer `pets/pocky`, proyectar al momento actual con la lógica **vieja** (última vez).
2. Escribir el resultado como nueva base: añadir `activityUntil: 0`, `sleepStartedAt: null`, convertir `lastUpdated` a Timestamp, **eliminar** `mood`, `age`, `needs`, `isConnected` (`FieldValue.delete()`).
3. Si `activity !== 'idle'` (doc atascado por C-1), forzar `idle`.

Desplegar app + cron actualizados inmediatamente después. Ventana de incompatibilidad: segundos (y `normalizeDoc` la tolera).

---

### FASE 2 — Notificaciones confiables (~1 día)

*(Detalles técnicos completos en ANALISIS.md §4; aquí el orden de ejecución)*

| # | Tarea | Ref | AC |
|---|-------|-----|-----|
| T2.1 | Eliminar la petición automática de permiso; solo botón 🔔, con detección de `standalone` en iOS y estados `granted/denied/default` diferenciados | C-3 | En iPhone PWA, pulsar 🔔 muestra el prompt del sistema; sin pulsar, jamás aparece |
| T2.2 | Separar `try` de FCM y Web Push; WebKit va directo a Web Push nativo | C-4 | iPhone registra suscripción Web Push y queda en Firestore |
| T2.3 | `setVapidDetails` dentro del handler con guarda + `VAPID_SUBJECT` real; `vapidKey` explícito en `getToken` | C-5, 4.2 | Sin VAPID configurado, el tick sigue degradando (push deshabilitado con warning) |
| T2.4 | **Un único service worker** `sw.js`: maneja `push`, precache del shell, `skipWaiting`/`clients.claim`, `notificationclick` que enfoca, `tag` estable | 4.1, 4.3, 4.5, U-1 | Notificación con app abierta → la enfoca, no abre otra. App abre offline |
| T2.5 | Cron horario vía scheduler externo (cron-job.org o GitHub Action `schedule` → `curl` con `CRON_SECRET`) — las tasas ya quedaron rebalanceadas en T1.1 | C-2 | Tick cada hora en logs; cooldown de 4 h por fin operativo |
| T2.6 | El cron usa `projectPet` y escribe nueva base (una sola escritura, `runtime='nodejs'` explícito) | 4.8, 4.9 | — |
| T2.7 | Necesidad + aviso de salud baja; mensaje priorizado en vez de concatenado | 4.6, 4.7 | `health<20` genera push "¡Pocky está enferm@!" |

### FASE 3 — Seguridad (~medio día)

| # | Tarea | Ref |
|---|-------|-----|
| T3.1 | Firebase Anonymous Auth: `signInAnonymously()` al arrancar; el UID pasa a ser el `deviceId` (adiós `localStorage` random) | C-6 |
| T3.2 | Tokens/suscripciones push a subcolección `pets/pocky/subscriptions/{uid}` — un doc por dispositivo: sin arrays que pisar (C-7), ilegibles desde cliente (`allow read: if false`), limpieza en cron = `delete()` del doc caducado | C-6, C-7 |
| T3.3 | Reglas nuevas: `read/update` solo autenticados, validación de rangos, campos de identidad inmutables, prohibido escribir campos derivados/tokens en el doc principal. Tests con `@firebase/rules-unit-testing` | C-6 |

### FASE 4 — Limpieza y pulido (~medio día)

- Borrar código muerto: `PetStats.tsx`, `ActionPad.tsx`, `firebaseAdmin.ts`, `requestFCMToken`, `MOOD_BG`, `bgClass`, prop `color`, campos `age`/`emoji` (ANALISIS §8).
- Unificar Tailwind (quitar `@tailwindcss/postcss` v4) (A-12).
- `persistentMultipleTabManager()` (A-8); tipado real de `app` (A-7); constante `PET_DOC` compartida (A-6).
- `.env.example` real + `.gitignore` con `!.env.example`; sincronizar README/AGENTS con las tasas y arquitectura nuevas (ANALISIS §9).
- Toasts propios en vez de `alert()` (U-2); quitar `userScalable: false` (U-3); mascota como `<button>` accesible (U-4).
- **Feature de producto:** mostrar `lastCareBy`/`lastCareAt` — "🐾 Ana cuidó a Pocky hace 5 min" (U-7). Es barato (los campos ya se escriben desde T1.4) y es el corazón del concepto "para dos".

---

## 5. Matriz de verificación manual (post Fase 1)

Ejecutar con dos dispositivos reales (o dos navegadores) A y B:

| # | Escenario | Resultado esperado |
|---|-----------|-------------------|
| 1 | A y B abiertos 10 min sin tocar | Mismos valores en ambos (±1) todo el tiempo |
| 2 | A alimenta | B refleja en <2 s; ningún stat rebota hacia arriba en ningún momento |
| 3 | A y B accionan simultáneamente | Ambas acciones aplicadas; `totalCaresGiven` +2 |
| 4 | B en background 1 h → volver | Valores correctos en <1 s |
| 5 | Dormir→Despertar ×10 seguidos | Energía varía <1 punto (bug 0→40 muerto) |
| 6 | Dormir 30 min reales | Energía +24 en ambos dispositivos |
| 7 | Matar app durante "comiendo" | A los 2,5 s (o al reabrir) todo vuelve a idle en ambos |
| 8 | Modo avión + intentar acción | Toast "sin conexión"; al reconectar NO aterriza ninguna escritura vieja |
| 9 | Adelantar el reloj del teléfono 1 día | La pantalla muestra degradación clampeada; al accionar, la BD NO absorbe el salto (serverTimestamp) |

---

## 6. Riesgos y mitigaciones

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| La migración corre con la app vieja aún desplegada y una acción vieja pisa el doc migrado | Media | Correr `migrate.mjs` y desplegar en la misma ventana; `normalizeDoc` tolera ambos formatos; avisarle a tu novia que no toque a Pocky esos 5 minutos 🙂 |
| `runTransaction` reintenta si el doc cambió → latencia perceptible en acciones simultáneas | Baja | Aceptable (reintento <1 s con 2 usuarios); `pending` da feedback inmediato |
| Rebalanceo de tasas deja el juego muy fácil/difícil | Media | Tasas centralizadas en `RATES` + tests que documentan las curvas; ajustar es un PR de 1 línea |
| iOS mata el SW unificado y se pierden push | Baja | Ya cubierto por diseño de Web Push (el SO entrega al SW registrado); probar matriz §5 en iPhone real |
| Scheduler externo gratuito falla en silencio | Media | El propio cron escribe `lastUpdated`; añadir al tick un log y (opcional) un aviso si detecta >3 h sin ejecuciones previas |

---

## 7. Resumen ejecutivo del plan

```
Fase 1 (2 días)   → Estado: proyección pura + transacciones + activityUntil + sueño por tiempo
                    ✓ arregla: valores distintos, sobrescrituras, 0→40, deadlock
Fase 2 (1 día)    → Notificaciones: gesto de usuario, iPhone funcional, SW único, cron horario
Fase 3 (0,5 días) → Seguridad: auth anónima, reglas cerradas, tokens en subcolección
Fase 4 (0,5 días) → Limpieza, docs, accesibilidad, "Ana cuidó a Pocky hace 5 min"
```

El orden no es negociable a la inversa: las Fases 2-4 escriben sobre el modelo de datos de la Fase 1. Empezar por notificaciones sobre el modelo actual sería notificar más rápido sobre un estado que sigue siendo mentira.
