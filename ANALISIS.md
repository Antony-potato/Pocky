# Análisis técnico de Pocky

> Auditoría completa de antipatrones, bugs funcionales, seguridad, rendimiento y del sistema de notificaciones.
> Fecha: 2026-07-25 · Commit base: `4253317` · ~1.419 LOC en `src/`

---

## 1. Resumen ejecutivo

Pocky es una PWA Next.js 16 (App Router) + Firestore + Zustand que mantiene una mascota virtual compartida entre dos personas, con degradación de stats vía Vercel Cron y push por doble transporte (FCM + Web Push).

La arquitectura base es correcta y el tamaño del proyecto es sano. Sin embargo hay **7 defectos bloqueantes** que hacen que hoy la app no cumpla su promesa central:

| # | Defecto | Impacto |
|---|---------|---------|
| **C-1** | Deadlock permanente de actividad | La app se puede quedar **inutilizable para siempre** sin arreglo desde la UI |
| **C-2** | El cron corre 1 vez al día, no cada hora | Máximo **1 notificación diaria**; los stats llegan a 0 todos los días |
| **C-3** | El permiso de notificaciones se pide sin gesto del usuario | **Rompe iOS/Safari** y quema el permiso de forma irreversible |
| **C-4** | El fallback de Web Push es inalcanzable si FCM lanza excepción | **iPhone nunca recibe push** en el caso más probable |
| **C-5** | `setVapidDetails()` a nivel de módulo | Si falta una env var, **el endpoint entero muere** (también la degradación) |
| **C-6** | Firestore abierto a internet sin autenticación | Cualquiera puede **leer las suscripciones push y mandarles notificaciones** |
| **C-7** | Race condition al registrar tokens push | En una app **para dos personas**, el segundo registro borra al primero |

Sumado a eso: 12 antipatrones de arquitectura/estado, 1 exploit de mecánica de juego, varios problemas de rendimiento en React, código muerto (3 archivos completos) y documentación desincronizada con el código.

**Recomendación de orden de trabajo:** C-1 → C-3 → C-4 → C-2 → C-5 → C-6/C-7 → resto.

---

## 2. Inventario y arquitectura actual

```
Cliente (PWA)                    Firestore                Servidor
─────────────                    ─────────                ────────
petStore.ts (Zustand)   ──sync──▶ pets/pocky ◀──update──  /api/cron/tick
   └ onSnapshot         ◀────────                          └ applyTick()
   └ tick() cada 20s (solo local)                          └ FCM multicast
PetScreen.tsx                                              └ web-push loop
   └ CircularStats / PetAvatar
```

| Capa | Archivos | Estado |
|------|----------|--------|
| Lógica pura | `src/lib/petLogic.ts` | Bien aislada, compartida cliente/servidor ✅ |
| Estado | `src/store/petStore.ts` (265 L) | Duplicación masiva, sin selectores ⚠️ |
| UI | `src/components/PetScreen.tsx` (300 L) | Componente monolítico ⚠️ |
| Servidor | `src/app/api/cron/tick/route.ts` (149 L) | Mezcla tick + notificaciones ⚠️ |
| Notificaciones | `src/lib/messaging.ts`, `public/*-sw.js` | Estructuralmente roto ❌ |
| Seguridad | `firestore.rules` | Sin autenticación ❌ |
| Muerto | `PetStats.tsx`, `ActionPad.tsx`, `firebaseAdmin.ts` | No se importan en ningún lado |

---

## 3. Defectos críticos (P0)

### C-1 · Deadlock permanente de actividad

**Archivos:** `src/store/petStore.ts:131-136, 159-163, 187-191, 214-218` · `src/components/PetScreen.tsx:252-295`

Cada acción escribe `activity: 'eating'` en Firestore y programa un `setTimeout` que 2,5–4 s después escribe `activity: 'idle'`:

```ts
set({ ...next, ... });
get().sync(next);                  // activity: 'eating' → BD

setTimeout(() => {
  get().sync({ activity: 'idle' }); // ← si esto no corre, nunca vuelve a idle
}, 2500);
```

Ese `setTimeout` vive **solo en la pestaña que lo lanzó**. Si el usuario cierra la app, bloquea el teléfono, pierde conexión o iOS suspende la PWA en esos 2,5 s, el documento queda con `activity: 'eating'` de forma indefinida.

A partir de ahí, en `PetScreen.tsx:254-258`:

```ts
const isBusy   = pet.activity !== 'idle';        // true para siempre
const isActive = pet.activity === a.activityId && isBusy;
const off = (pet.isAsleep && a.id !== 'wake') || (isBusy && !isActive) || a.customDisabled;
```

- Todos los botones cuyo `activityId` no coincida quedan `disabled`.
- El botón que sí coincide (ej. Alimentar) se ve habilitado, pero al pulsarlo el store aborta: `if (s.isAsleep || s.activity !== 'idle') return;` (`petStore.ts:111`).
- **Dormir está deshabilitado**, así que no se puede recuperar energía.
- `applyTick()` solo resetea `activity` cuando `energy >= 95` (`petLogic.ts:56`), y la energía únicamente sube durmiendo.

**Resultado: estado irrecuperable. La única salida es editar el documento a mano en la consola de Firebase.** Es el bug más grave del proyecto.

**Corrección.** Dejar de tratar la actividad como estado persistente con apagado diferido. Persistir un vencimiento y derivar la actividad del reloj:

```ts
// types/pet.ts
activityUntil?: number;   // timestamp ms en que la actividad expira

// petLogic.ts — fuente de verdad única
export function getActivity(s: PetData, now = Date.now()): PetActivity {
  if (s.isAsleep) return 'sleeping';
  if (s.activityUntil && now < s.activityUntil) return s.activity;
  return 'idle';
}
```

Con eso: no hace falta `setTimeout` para sincronizar, la actividad se autolimpia en ambos dispositivos, y un cierre de app no deja nada colgado. El `setTimeout` se queda solo para refrescar la UI local.

**Mitigación inmediata** (una línea, sin cambio de esquema) en `applyTick`:

```ts
// petLogic.ts:56 — ninguna actividad dura más de 1 minuto
activity: (!s.isAsleep && mins >= 1) ? 'idle' : s.activity,
```

Además, guardar el id del timeout y limpiarlo al desmontar.

---

### C-2 · El cron corre una vez al día, no cada hora

**Archivos:** `vercel.json` · `README.md:13,215` · `AGENTS.md:32`

```json
{ "path": "/api/cron/tick", "schedule": "0 0 * * *" }   // ← diario a las 00:00 UTC
```

La documentación afirma en tres sitios que corre **cada hora**. Corre **cada 24 h**. Consecuencias en cadena:

**a) Las notificaciones son, como máximo, una al día y siempre a la misma hora.**
El push solo se puede emitir dentro de una ejecución del cron. Con una ejecución diaria a las 00:00 UTC, la notificación llega siempre alrededor de las 18:00–19:00 hora de México. El cooldown de 4 horas de `route.ts:74-77` es **código muerto**: nunca se puede violar.

**b) La mascota está siempre en cero cuando llega la notificación.**
Con las tasas actuales de `petLogic.ts:37-40`, partiendo de `DEFAULT_PET`:

| Stat | Tasa | Llega a umbral de aviso (<30) | Llega a 0 |
|------|------|-------------------------------|-----------|
| Felicidad | −0,195/min | **3,4 h** | 6,0 h |
| Hambre | −0,13/min | 6,4 h | 10,2 h |
| Limpieza | −0,13/min | 7,7 h | 11,5 h |
| Energía | −0,156/min | — | 9,1 h |

Pocky pide atención a las 3,4 h y muere de hambre a las 10 h, pero solo avisa cada 24 h. La salud cae 0,5/min (−30/h) en cuanto hay dos stats bajo 20, así que llega a 0 a diario.

**c) La degradación no es realmente 24/7**, es un salto brusco diario.

**Causa probable y solución.** En el plan **Hobby de Vercel los cron jobs están limitados a una ejecución diaria** y sin garantía de minuto exacto. El `0 0 * * *` seguramente no es un descuido sino una restricción de plan. Opciones:

1. **Plan Pro** de Vercel → `"schedule": "0 * * * *"` y listo.
2. **Scheduler externo gratuito** golpeando el mismo endpoint (recomendado si se quiere seguir en $0): [cron-job.org](https://cron-job.org), GitHub Actions con `schedule`, o un Cloudflare Worker con Cron Trigger. El endpoint ya está protegido por `Authorization: Bearer $CRON_SECRET`, así que sirve tal cual.
3. **Cloud Functions for Firebase** con `onSchedule` (requiere plan Blaze, pero la cuota gratuita cubre de sobra 24 invocaciones/día).

Sea cual sea la vía, **ajustar las tasas de degradación al ritmo real de aviso**. Con cron horario y notificación cada 4 h, unas tasas razonables serían las que dan ~24–36 h de autonomía:

```ts
hunger      = clamp(hunger      - mins * 0.045);  // 100 → 0 en ~37 h
happiness   = clamp(happiness   - mins * 0.055);  // 100 → 0 en ~30 h
cleanliness = clamp(cleanliness - mins * 0.035);  // 100 → 0 en ~48 h
energy      = clamp(energy      - mins * 0.050);  // 100 → 0 en ~33 h
```

---

### C-3 · Se pide el permiso de notificaciones sin gesto de usuario

**Archivo:** `src/components/PetScreen.tsx:77-92`

```ts
useEffect(() => {
  if (!isMounted) return;
  const unsub = pet.startListening();
  requestNotificationPermission().then(result => { ... });  // ← automático al montar
  ...
}, [isMounted]);
```

Esto viola la restricción que el propio `AGENTS.md:50` documenta: *"Push notifications only work after the user registers through a manual action"*.

Problemas concretos:

1. **En Safari iOS falla siempre.** WebKit exige que `Notification.requestPermission()` se invoque dentro de un manejador de gesto de usuario. Fuera de él, la promesa se resuelve sin mostrar prompt. El iPhone —la plataforma principal del proyecto según el README— nunca llega a registrarse.
2. **El permiso es de un solo tiro.** Si el navegador responde `denied` (Chrome auto-deniega prompts sin gesto tras abuso, Firefox exige gesto), el estado queda pegado. A partir de ese momento **el botón 🔔 tampoco funciona nunca**, porque `requestPermission()` sobre un permiso denegado devuelve `denied` sin preguntar. El usuario tiene que ir a los ajustes del sistema.
3. **Registra service workers en cada carga**, aunque el usuario no quiera notificaciones.
4. Mala UX: un prompt del sistema en el primer segundo, sin contexto de por qué.

**Corrección.** Quitar la llamada automática y dejar solo el botón. Añadir además una comprobación previa del estado del permiso para no mostrar un botón inútil:

```ts
// PetScreen.tsx
useEffect(() => {
  if (!isMounted) return;
  const unsub = pet.startListening();
  const interval = setInterval(() => usePetStore.getState().tick(), 20000);
  return () => { unsub(); clearInterval(interval); };
}, [isMounted]);

// Estado del permiso para pintar el botón
const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
useEffect(() => {
  if (!isMounted) return;
  setPermission('Notification' in window ? Notification.permission : 'unsupported');
}, [isMounted]);
```

Y en el handler del botón, distinguir los tres casos (`granted` → re-registrar por si el token rotó, `denied` → explicar cómo reactivarlo en ajustes, `default` → pedir).

**Extra iOS:** el push en PWA de iOS solo funciona si está **instalada en la pantalla de inicio**. Conviene detectarlo y explicarlo en vez de fallar en silencio:

```ts
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  || (window.navigator as any).standalone === true;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
if (isIOS && !isStandalone) {
  // "Añade Pocky a tu pantalla de inicio para recibir avisos"
}
```

---

### C-4 · El fallback de Web Push es inalcanzable

**Archivo:** `src/lib/messaging.ts:12-74`

Toda la función vive dentro de un único `try`. La rama FCM va primero:

```ts
try {
  const fcmSupported = await isSupported();
  if (fcmSupported) {
    const messaging = getMessaging(app);
    ...
    const currentToken = await getToken(messaging, { serviceWorkerRegistration: registration });
    if (currentToken) return { type: 'fcm', token: currentToken };
  }

  // 3. Fallback: Web Push nativo (Safari/iOS PWA)   ← solo se llega si getToken NO lanza
  ...
} catch (error) {
  console.error(...);
  return null;     // ← cualquier fallo de FCM mata también el camino de Safari
}
```

En Safari iOS 16.4+ instalada como PWA, `isSupported()` de `firebase/messaging` **devuelve true** (existen `serviceWorker`, `PushManager`, `Notification`, `PushSubscription.prototype.getKey`). Se entra por la rama FCM, `getToken()` falla —lo normal, porque el proyecto no tiene la configuración de APNs/`vapidKey` correcta para ese contexto— y **lanza una excepción**. El `catch` externo la captura y devuelve `null`.

Es decir: en el escenario más probable en iPhone, **el código nunca ejecuta el camino de Web Push nativo que se escribió justamente para iPhone**.

**Corrección.** Aislar cada transporte en su propio `try`, y ordenar por plataforma en lugar de "FCM primero siempre":

```ts
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return null;
  if (Notification.permission === 'denied') return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const isAppleWebKit = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (/Safari/.test(navigator.userAgent) && !/Chrom/.test(navigator.userAgent));

  // En WebKit ni siquiera intentamos FCM: Web Push nativo directo.
  if (!isAppleWebKit) {
    try {
      const t = await tryFCM();
      if (t) return { type: 'fcm' as const, token: t };
    } catch (e) {
      console.warn('FCM no disponible, probando Web Push nativo:', e);
    }
  }

  try {
    const sub = await tryWebPush();
    if (sub) return { type: 'webpush' as const, subscription: sub };
  } catch (e) {
    console.error('Web Push nativo falló:', e);
  }

  return null;
}
```

---

### C-5 · `setVapidDetails()` a nivel de módulo tumba el endpoint entero

**Archivo:** `src/app/api/cron/tick/route.ts:24-28`

```ts
webPush.setVapidDetails(
  'mailto:pocky@example.com',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || ''
);
```

Dos problemas:

1. **Se ejecuta al importar el módulo**, no dentro del handler. `web-push` valida las claves y **lanza** si la pública no decodifica a 65 bytes o la privada a 32. Con `|| ''` el resultado es una excepción en tiempo de carga: la ruta responde 500 antes de entrar al `GET`. **Se cae también la degradación de stats**, no solo el push. Un fallo de configuración de notificaciones rompe la mecánica central del juego.
2. `'mailto:pocky@example.com'` es un placeholder. Algunos push services usan el `subject` para contactar ante abusos y penalizan o rechazan direcciones inválidas.

**Corrección.** Mover la configuración dentro del bloque de push, con guarda:

```ts
const VAPID_PUBLIC  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:tu-correo-real@dominio.com';

const webPushReady = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (webPushReady) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC!, VAPID_PRIVATE!);
} else {
  console.warn('[Cron] VAPID sin configurar — Web Push deshabilitado');
}
// ...más abajo:  if (hasWebPush && webPushReady) { ... }
```

**Nota de configuración importante:** el par VAPID de `web-push` (generado con `npx web-push generate-vapid-keys`) y el "Web Push certificate" de la consola de Firebase **son dos pares distintos**. La rama FCM necesita el de Firebase; la rama Web Push nativo necesita el propio. Mezclarlos produce fallos silenciosos de suscripción.

---

### C-6 · Firestore abierto a internet sin autenticación

**Archivo:** `firestore.rules`

```
allow read: if true;
allow create: if true;
allow update: if <solo validación de forma>;
```

No hay ninguna capa de autenticación en el proyecto (no se importa `firebase/auth` en ningún sitio). El `projectId` viaja en el bundle del cliente, como es normal en Firebase — pero eso significa que **cualquiera que abra la app puede leer y escribir el documento directamente vía la API REST de Firestore.**

El riesgo serio no es que alguien manipule el hambre de Pocky. Es que `allow read: if true` expone:

- `webPushSubscriptions[]` → contiene `endpoint`, `keys.p256dh` y `keys.auth`. **Con esos tres valores cualquiera puede enviar notificaciones push arbitrarias a los teléfonos de los dos usuarios**, sin pasar por la app. Es un canal de spam/phishing directo a la pantalla de bloqueo.
- `fcmTokens[]` → menos explotable (haría falta la clave de servidor del proyecto), pero es un identificador de dispositivo que no debería ser público.

**Corrección mínima (mantiene el coste en $0).** Firebase Anonymous Auth + separar los secretos del documento público:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /pets/{petId} {
      allow read:   if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null
                    && request.resource.data.keys().hasAll(['hunger','happiness','cleanliness','energy','health'])
                    && request.resource.data.hunger      is number && request.resource.data.hunger      >= 0 && request.resource.data.hunger      <= 100
                    && request.resource.data.happiness   is number && request.resource.data.happiness   >= 0 && request.resource.data.happiness   <= 100
                    && request.resource.data.cleanliness is number && request.resource.data.cleanliness >= 0 && request.resource.data.cleanliness <= 100
                    && request.resource.data.energy      is number && request.resource.data.energy      >= 0 && request.resource.data.energy      <= 100
                    && request.resource.data.health      is number && request.resource.data.health      >= 0 && request.resource.data.health      <= 100
                    && request.resource.data.name    == resource.data.name
                    && request.resource.data.species == resource.data.species
                    // Los tokens ya no viven aquí:
                    && !request.resource.data.keys().hasAny(['fcmTokens','webPushSubscriptions']);
      allow delete: if false;
    }

    // Suscripciones push: escribibles por su dueño, NUNCA legibles desde el cliente.
    // Solo el Admin SDK (que salta las reglas) las lee en el cron.
    match /pets/{petId}/subscriptions/{deviceId} {
      allow read:   if false;
      allow write:  if request.auth != null && deviceId == request.auth.uid;
    }
  }
}
```

Esto además resuelve C-7 de forma natural (ver abajo). Para restringirlo de verdad a dos personas, lo siguiente sería una allowlist de UIDs o Auth con proveedor de email.

**Adicional:** las reglas actuales no acotan el tamaño ni el número de campos, así que cualquiera puede inflar el documento hasta el límite de 1 MiB.

---

### C-7 · Race condition al registrar tokens push

**Archivo:** `src/store/petStore.ts:61-87`

```ts
registerFCMToken: async (token) => {
  const currentTokens = get().fcmTokens || [];       // 1. leer estado local
  if (!currentTokens.includes(token)) {
    const newTokens = [...currentTokens, token];     // 2. modificar en memoria
    await setDoc(doc(db, PET_DOC), { fcmTokens: newTokens }, { merge: true }); // 3. escribir array completo
  }
}
```

Es el patrón **read-modify-write** clásico, y aquí duele especialmente: Pocky es explícitamente *"una mascota virtual para dos"*. Si los dos usuarios activan las notificaciones con poca diferencia de tiempo —o si uno lo hace antes de que el `onSnapshot` del otro haya propagado—, **el segundo `setDoc` sobrescribe el array completo y borra el token del primero**. Uno de los dos deja de recibir avisos y nadie se entera.

La ventana se agranda porque la lectura viene del store de Zustand, no de Firestore: si `onSnapshot` aún no ha entregado el estado remoto, `currentTokens` es `[]` y el registro **borra todos los tokens existentes**.

Lo mismo aplica a `registerWebPushSubscription` (`petStore.ts:73-87`).

El servidor tiene el mismo defecto en `route.ts:108,133`: `updateData.fcmTokens = tokensToKeep` reescribe el array completo con la foto que leyó al principio del tick, pisando cualquier registro ocurrido durante la ejecución.

**Corrección A (mínima).** Usar el operador atómico de Firestore:

```ts
import { arrayUnion, arrayRemove } from 'firebase/firestore';

registerFCMToken: async (token: string) => {
  await setDoc(doc(db, PET_DOC), { fcmTokens: arrayUnion(token) }, { merge: true });
},
```

Y en el cron, para limpiar tokens caducados, `arrayRemove(...failedTokens)` en vez de reescribir.

**Corrección B (recomendada).** Migrar a la subcolección `pets/pocky/subscriptions/{deviceId}` del bloque anterior: cada dispositivo es un documento independiente, no hay array que pisar, la limpieza de suscripciones caducadas es un `delete` puntual, y las suscripciones dejan de ser legibles públicamente. Resuelve C-6 y C-7 de una vez.

---

## 4. Análisis dedicado del sistema de notificaciones

Recorrido completo del flujo, más allá de los críticos ya listados.

### 4.1 Los dos service workers se pelean por el mismo scope

**Archivos:** `src/lib/messaging.ts:34,48` · `public/firebase-messaging-sw.js` · `public/sw-push.js`

```ts
registration = await navigator.serviceWorker.register(swUrl);        // scope por defecto: '/'
...
const registration = await navigator.serviceWorker.register('/sw-push.js');  // scope por defecto: '/'
```

Las registraciones de service worker se indexan **por scope**, no por URL de script. Registrar `sw-push.js` en `/` **reemplaza** la registración de `firebase-messaging-sw.js` en `/`. Si en una sesión falla FCM y se cae al fallback, el SW de FCM queda desinstalado; en la siguiente sesión, si FCM funciona, vuelve a pisar al de push nativo. En dispositivos que alternan (o tras un cambio de navegador) el resultado es errático: notificaciones que dejan de llegar sin motivo aparente.

**Corrección.** Scopes separados y explícitos:

```ts
// FCM
await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/fcm/' });
// Web Push nativo
await navigator.serviceWorker.register('/sw-push.js', { scope: '/push/' });
```

(Requiere que ambas rutas existan o servir la cabecera `Service-Worker-Allowed`.) La alternativa más limpia es **un único service worker** que maneje tanto `push` como `onBackgroundMessage`, ya que ambos acaban llamando a `showNotification`.

### 4.2 `getToken()` sin `vapidKey`

**Archivo:** `src/lib/messaging.ts:37-39`

```ts
const currentToken = await getToken(messaging, { serviceWorkerRegistration: registration });
```

Sin `vapidKey`, el SDK usa una clave pública por defecto que solo sirve si el proyecto no tiene un certificado Web Push propio configurado. En cuanto se genera uno en la consola de Firebase, `getToken()` empieza a fallar. Debe pasarse explícitamente:

```ts
const currentToken = await getToken(messaging, {
  vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,  // el de la consola de Firebase
  serviceWorkerRegistration: registration,
});
```

Ojo con el nombre: hoy `NEXT_PUBLIC_VAPID_PUBLIC_KEY` se usa para el push nativo. Conviene una variable separada para no confundir los dos pares (ver C-5).

### 4.3 El click en la notificación abre una ventana nueva cada vez

**Archivo:** `public/sw-push.js:24-29`

```js
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));   // siempre ventana nueva
});
```

Si la PWA ya está abierta, se abre una segunda instancia en vez de enfocar la existente. En iOS eso significa recargar la app completa (pantalla "Despertando a Pocky…", re-suscripción a Firestore) cada vez que se toca un aviso.

**Corrección:**

```js
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = all.find(c => new URL(c.url).pathname === target);
    if (existing) return existing.focus();
    return clients.openWindow(target);
  })());
});
```

### 4.4 Las notificaciones se pisan entre sí y no se pueden agrupar

Tanto `route.ts:78` como `sw-push.js:13-17` y `firebase-messaging-sw.js:21-24` construyen la notificación **sin `tag`, sin `renotify`, sin `data` y sin `actions`**.

- Sin `tag`, en Android cada aviso apila uno nuevo; con un `tag` estable se reemplazaría el anterior (que es lo deseable aquí: solo importa el estado actual).
- Sin `data.url` no hay forma de hacer deep-link a una acción concreta.
- Sin `actions` se pierde la mejor mejora de UX posible: **atender a Pocky desde la propia notificación** ("Alimentar" / "Jugar") sin abrir la app.

### 4.5 El `sw-push.js` no toma control hasta cerrar todas las pestañas

Falta el par habitual:

```js
self.addEventListener('install',  (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
```

Sin esto, cualquier corrección del service worker (incluidas las de 4.3 y 4.4) no surte efecto hasta que el usuario cierre todas las instancias de la PWA — algo que en iOS casi nunca ocurre.

### 4.6 No existe notificación por salud baja

**Archivo:** `src/lib/petLogic.ts:17-28`

`getNeeds()` cubre hambre, limpieza, felicidad y sueño. **No cubre `health`.** La salud es el único stat con consecuencia real (cae 0,5/min cuando dos stats están bajo 20) y es el único del que nunca se avisa. Pocky puede llegar a `health: 0` sin que suene el teléfono.

```ts
if (s.health < 40)
  needs.push({
    id: 'health',
    emoji: '❤️‍🩹',
    urgency: s.health < 20 ? 'critical' : 'high',
    message: s.health < 20 ? `¡${s.name} está enferm@!` : `${s.name} no se siente bien`,
  });
```

(Requiere añadir el icono correspondiente a `NEED_ICONS` en `PetScreen.tsx:24-29`; hoy un `id` desconocido renderiza sin icono en silencio.)

### 4.7 El cuerpo del mensaje se concatena sin límite

**Archivo:** `src/app/api/cron/tick/route.ts:79`

```ts
const body = criticalNeeds.map(n => n.message).join(' y ');
```

Con las cuatro necesidades activas —el caso normal tras 12 h sin atención— sale: *"¡Pocky está muy hambri@! y Pocky necesita baño y Pocky está aburrido/a y Pocky tiene sueño"*. Además el título es siempre idéntico.

Mejor: priorizar la necesidad más urgente y resumir el resto.

```ts
const top = criticalNeeds[0];
const rest = criticalNeeds.length - 1;
const title = rest > 0 ? `${pet.name} necesita ${criticalNeeds.length} cosas` : '¡Pocky te necesita!';
const body  = rest > 0 ? `${top.message} (+${rest} más)` : top.message;
```

### 4.8 Doble escritura en Firestore por tick

**Archivo:** `src/app/api/cron/tick/route.ts:56-61` y `137`

El cron hace `ref.update(...)` para los stats y luego un segundo `ref.update(updateData)` para el cooldown y los tokens. Son dos escrituras donde basta una: acumular todo en un objeto y escribir al final. Irrelevante para la cuota, pero amplía la ventana de la race condition de C-7.

### 4.9 Falta `runtime` explícito en la ruta

`AGENTS.md:52` advierte que `firebase-admin` no es compatible con el edge runtime. El App Router usa Node.js por defecto para route handlers, así que hoy funciona — pero conviene fijarlo para que no se rompa ante un cambio de configuración:

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
```

### 4.10 Resumen del estado de notificaciones

| Plataforma | ¿Funciona hoy? | Bloqueante |
|-----------|----------------|------------|
| Android / Chrome | Parcial | C-2 (1 aviso/día), 4.2 (`vapidKey`), 4.1 (scope) |
| iPhone / Safari PWA | **No** | C-3 (sin gesto), C-4 (fallback inalcanzable), C-2 |
| Escritorio Chrome | Parcial | Igual que Android |
| Cualquiera, si falta VAPID | **No, y además tumba la degradación** | C-5 |

---

## 5. Antipatrones de arquitectura y estado

### A-1 · Estado de UI escrito en la base de datos

**Archivo:** `src/store/petStore.ts:109-137` (y las otras cuatro acciones)

```ts
const s = get();                            // ← el store COMPLETO: stats + needs + isConnected + acciones
const realState = { ...s, ...applyTick(s) };
const next = { ...realState, activity: 'eating', ... };
get().sync(next);                           // ← se escribe todo
```

`sync()` filtra funciones (`petStore.ts:46-48`), pero **no filtra `needs` ni `isConnected`**, que son estado derivado exclusivo de la UI. Ambos acaban persistidos en Firestore en cada acción: `needs` como un array de objetos que se recalcula igual en cada cliente, `isConnected` como un booleano que no significa nada fuera del dispositivo que lo escribió.

**Corrección.** Separar `PetData` (persistente) de `PetUiState` (derivado) en el tipado del store, y hacer que `sync` acepte solo lo primero:

```ts
type PetStore = PetData & PetUiState & PetActions;

const PERSISTED_KEYS = ['name','species','hunger','happiness','cleanliness','energy',
  'health','mood','activity','isAsleep','age','createdAt','lastUpdated',
  'totalCaresGiven','lastSyncedBy'] as const;

function toPetData(s: Partial<PetStore>): Partial<PetData> {
  return Object.fromEntries(
    PERSISTED_KEYS.filter(k => k in s).map(k => [k, s[k]])
  ) as Partial<PetData>;
}
```

Un allowlist explícito es más seguro que el `typeof value !== 'function'` actual, que es un filtro por accidente.

### A-2 · Duplicación masiva en las acciones del store

Las cinco acciones (`feed`, `bathe`, `walk`, `play`, más `putToSleep`/`wakeUp`) repiten literalmente el mismo esqueleto de 25 líneas: guarda de estado → `applyTick` → deltas → `set` → `sync` → `setTimeout` → `set` → `sync`. Son ~150 de las 265 líneas del archivo.

**Corrección.** Una tabla de datos y un ejecutor genérico:

```ts
const ACTIONS = {
  feed:  { activity: 'eating',  ms: 2500, requires: {}, deltas: { hunger: +15, happiness: +5 } },
  treat: { activity: 'eating',  ms: 2500, requires: {}, deltas: { hunger: +25, happiness: +10 } },
  bathe: { activity: 'bathing', ms: 3000, requires: {}, deltas: { cleanliness: +40, health: +5 } },
  walk:  { activity: 'walking', ms: 4000, requires: { energy: 15 }, deltas: { happiness: +20, energy: -10, health: +5, hunger: -5 } },
  play:  { activity: 'playing', ms: 3000, requires: { energy: 10 }, deltas: { happiness: +15, energy: -8, hunger: -5 } },
} as const;

perform: (id: keyof typeof ACTIONS) => { /* una sola implementación */ }
```

Además de eliminar la duplicación, esto centraliza el arreglo de C-1: un solo sitio donde manejar el vencimiento de la actividad. Y hace trivial el balanceo del juego, porque todos los números quedan en una tabla legible.

### A-3 · El reloj del cliente es la fuente de verdad temporal

**Archivos:** `src/lib/petLogic.ts:31` · `src/store/petStore.ts:54,125`

```ts
const mins = (now - s.lastUpdated) / 60000;    // now = Date.now() del dispositivo
...
lastUpdated: Date.now(),                       // escrito desde el cliente
updatedAt: serverTimestamp(),                  // escrito desde el servidor... pero no se usa
```

Hay dos timestamps con semánticas distintas y la lógica usa el **menos fiable**. Si el reloj de un teléfono va adelantado una hora, ese dispositivo calcula 60 minutos de degradación extra y los persiste para ambos usuarios. Si va atrasado, "resucita" stats. `updatedAt` (que sí es de servidor) no se lee en ninguna parte.

**Corrección.** Usar `serverTimestamp()` como `lastUpdated` y leerlo de vuelta del snapshot, o —más simple— acotar el salto:

```ts
const rawMins = (now - s.lastUpdated) / 60000;
const mins = Math.min(Math.max(rawMins, 0), 60 * 48);  // ni negativo ni más de 48 h
```

El `Math.max(…, 0)` también protege del caso "reloj atrasado", que hoy **suma** stats (multiplicar por `mins` negativo invierte el signo de la degradación).

### A-4 · Degradación aplicada dos veces entre dispositivos

`tick()` (`petStore.ts:257-265`) actualiza `lastUpdated` **solo en memoria local**, por diseño documentado en `AGENTS.md:39`. Pero entonces:

1. Dispositivo A degrada localmente y avanza su `lastUpdated`.
2. Dispositivo B (con un `lastUpdated` más antiguo, el de la BD) ejecuta una acción y hace `sync` con **su** cálculo.
3. `onSnapshot` en A hace `set({ ...data })` y **retrocede el `lastUpdated` de A** al valor de B.
4. El siguiente tick de A vuelve a degradar ese intervalo ya contabilizado.

El efecto visible son stats que dan pequeños saltos hacia atrás cuando el otro usuario interactúa. La causa raíz es que no hay autoridad única sobre el tiempo. Se resuelve junto con A-3: si `lastUpdated` siempre viene del servidor y el cliente solo *proyecta* la degradación para pintar (sin tocar el `lastUpdated` que usará el siguiente `applyTick`), el problema desaparece.

### A-5 · Exploit: energía infinita

**Archivo:** `src/store/petStore.ts:240-255`

```ts
wakeUp: () => {
  const s = get();
  const realState = { ...s, ...applyTick(s) };
  const energy = clamp(realState.energy + 30);   // +30 fijo, sin importar cuánto durmió
  ...
}
```

`applyTick` devuelve `{}` si han pasado menos de 60 s (`petLogic.ts:32`), así que **Dormir → Despertar en el mismo segundo regala +30 de energía**, repetible sin límite. Con energía infinita, "Jugar" (+15 felicidad) y "Pasear" (+20 felicidad, +5 salud) también son infinitos. Toda la economía del juego colapsa con dos toques.

Además `wakeUp` **no tiene guarda alguna**: no comprueba `isAsleep` ni `activity`. Hoy solo lo protege que la UI oculte el botón.

**Corrección:**

```ts
wakeUp: () => {
  const s = get();
  if (!s.isAsleep) return;                                  // guarda que faltaba
  const slept = (Date.now() - s.lastUpdated) / 60000;
  const realState = { ...s, ...applyTick(s) };
  // La energía ya la acumula applyTick (+0.39/min mientras duerme).
  // El bonus de despertar se gana solo si durmió de verdad.
  const bonus = slept >= 20 ? 10 : 0;
  const energy = clamp(realState.energy + bonus);
  ...
}
```

Y por simetría, `putToSleep` debería impedir dormir con la energía ya al máximo.

### A-6 · Constante `pets/pocky` duplicada

`petStore.ts:18` (`const PET_DOC = 'pets/pocky'`) y `route.ts:39` (`db.doc('pets/pocky')`). Cualquier cambio futuro a multi-mascota exige tocar dos sitios sin que nada avise. Extraer a `src/lib/constants.ts`.

### A-7 · `export let app: any`

**Archivo:** `src/lib/firebase.ts:14`

```ts
export let app: any;
```

Un `any` exportado y mutable en el módulo raíz de Firebase. Se pierde todo el tipado aguas abajo (`getMessaging(app)` deja de validar). Además los `import` están partidos: la línea 21 importa `initializeFirestore` en mitad del archivo.

```ts
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
```

### A-8 · `persistentLocalCache()` sin gestor multipestaña

**Archivo:** `src/lib/firebase.ts:25-27`

```ts
export const db = initializeFirestore(app, { localCache: persistentLocalCache() });
```

Sin `tabManager: persistentMultipleTabManager()`, la segunda pestaña que abra la app falla al obtener acceso exclusivo a la capa de persistencia. En una PWA instalada + el navegador abierto en el mismo sitio, es un escenario real.

```ts
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
```

### A-9 · Campo `age` muerto

`PetData.age` (`types/pet.ts:23`) se inicializa a 0 y **nunca se actualiza**. La edad real se calcula en el cliente con `computeAge(createdAt)` (`PetScreen.tsx:57`). Un campo persistido que siempre miente. Eliminarlo del tipo y del documento.

### A-10 · `PetNeed.emoji` no se usa

`getNeeds()` rellena `emoji` en cada necesidad, pero la UI usa `NEED_ICONS` de lucide (`PetScreen.tsx:24-29`) y el cron solo usa `message`. Campo escrito que nadie lee.

### A-11 · Sin manejo de errores visible

Todos los `catch` del store hacen `console.error` y siguen (`petStore.ts:56-58, 70, 86`). Si `sync()` falla —sin red, reglas rechazando la escritura— el usuario ve la acción aplicada localmente y **cree que se guardó**. No hay reintento, ni indicador, ni rollback. El punto verde/rojo de conexión (`PetScreen.tsx:158`) solo refleja errores del `onSnapshot`, no de las escrituras.

### A-12 · Mezcla de Tailwind v3 y v4

`package.json` declara `@tailwindcss/postcss@^4.2.1` en `dependencies` **y** `tailwindcss@^3.4.0` en `devDependencies`. La configuración real es toda v3 (`postcss.config.mjs` con `tailwindcss: {}`, `tailwind.config.ts`, `@tailwind base/components/utilities` en `globals.css`). El paquete v4 es peso muerto que puede confundir builds futuras. Elegir una versión y quitar la otra.

---

## 6. Rendimiento y React

### R-1 · Suscripción al store completo → re-render global

**Archivo:** `src/components/PetScreen.tsx:54`

```ts
const pet = usePetStore();   // sin selector: se suscribe a TODO el store
```

Cualquier cambio de cualquier campo re-renderiza los 300 líneas de `PetScreen` con sus hijos. Y como `tick()` corre cada 20 s, eso son **3 re-renders completos por minuto** de forma permanente, más uno por cada snapshot del otro dispositivo.

```ts
import { useShallow } from 'zustand/react/shallow';

const { hunger, happiness, cleanliness, energy, health, mood, activity, isAsleep, needs, isConnected, name, species, createdAt } =
  usePetStore(useShallow(s => ({ ...seleccionar solo lo que se pinta... })));

// Las acciones son estables: sacarlas del store sin suscribirse
const { feed, bathe, walk, play, putToSleep, wakeUp } = usePetStore.getState();
```

### R-2 · `Math.random()` dentro del render

**Archivo:** `src/components/PetScreen.tsx:138-151`

```tsx
{Array.from({ length: 30 }).map((_, i) => (
  <div key={i} style={{ top: `${Math.random() * 60}%`, left: `${Math.random() * 100}%`, ... }} />
))}
```

Combinado con R-1, **las 30 estrellas saltan a posiciones nuevas cada 20 segundos**. Es un glitch visible durante todo el modo noche. Lo mismo aplica a `FloatingHearts` (`PetScreen.tsx:41`), aunque ahí el remontaje por `key` es intencional.

```tsx
const stars = useMemo(
  () => Array.from({ length: 30 }, () => ({
    top: Math.random() * 60, left: Math.random() * 100,
    delay: Math.random() * 3, opacity: 0.4 + Math.random() * 0.6,
    size: 1 + Math.random() * 2,
  })),
  []
);
```

### R-3 · `setTimeout` sin limpiar

Los cinco `setTimeout` del store no guardan su id ni se cancelan al desmontar. Si el componente se desmonta o se dispara una acción nueva antes de que venza el anterior, quedan callbacks huérfanos escribiendo en Firestore. Es la otra cara de C-1.

### R-4 · Objeto `actions` recreado en cada render

`PetScreen.tsx:103-117` construye el array de acciones —con seis elementos JSX de lucide dentro— en cada render. Con R-1 arreglado importa menos, pero conviene `useMemo` sobre las dependencias reales (`pet.isAsleep`, `pet.energy`).

### R-5 · `isMounted` desactiva el SSR por completo

`PetScreen.tsx:119-128` devuelve un spinner hasta que `useEffect` marca el montaje. El patrón es correcto para evitar mismatches de hidratación, pero implica que **toda la app es client-only** y muestra "Despertando a Pocky…" en cada arranque. Se puede reducir renderizando el layout estático (fondo, barra superior, panel de acciones deshabilitado) desde el servidor y gateando solo lo dependiente del reloj y de Firebase.

### R-6 · Lottie importado estáticamente

`PetAvatar.tsx:5` hace `import playingAnimation from '../../public/pocky-cat/pockyJugando.json'`. El JSON de la animación entra en el bundle principal aunque solo se use durante los 3 s de "jugando". El componente `Lottie` sí es dinámico, pero los datos no. Cargar el JSON con `import()` dentro del rama de `playing`.

---

## 7. UX, PWA y accesibilidad

### U-1 · La PWA no funciona sin conexión

No hay ningún service worker de precaché. `next.config.ts:18-24` define cabeceras para `/sw.js`, pero **ese archivo no existe** — es configuración muerta. Firestore sí tiene persistencia local (A-8), pero el *app shell* no está cacheado: abrir la PWA sin red da pantalla en blanco. Para una app instalada en la pantalla de inicio es un fallo de expectativa básico.

Solución mínima: `@ducanh2912/next-pwa` o `next-pwa`, o un service worker propio que cachee el shell con estrategia *stale-while-revalidate*. Se puede unificar con el SW de push (4.1).

### U-2 · `alert()` como feedback

`PetScreen.tsx:66,74`. Bloquea el hilo principal, se ve como diálogo de navegador (rompiendo la ilusión de app nativa) y en algunos contextos de PWA instalada está limitado. Sustituir por un toast propio.

### U-3 · El zoom está bloqueado

`layout.tsx:43-44`: `maximumScale: 1, userScalable: false`. Es un incumplimiento de WCAG 1.4.4 (Resize Text) y afecta a cualquiera con baja visión. En iOS 10+ Safari ignora el flag de todas formas, así que se pierde accesibilidad sin ganar nada.

### U-4 · La mascota no es accesible por teclado

`PetScreen.tsx:206`: `<div onClick={handlePetTap}>` sin `role`, `tabIndex` ni handler de teclado. Debería ser un `<button>` con `aria-label`.

### U-5 · `img { pointer-events: none }` global

`globals.css:34`. Hoy funciona (el click cae al div padre), pero es una regla global que romperá cualquier imagen interactiva que se añada en el futuro. Acotarla al avatar con una clase.

### U-6 · Solapamiento de alertas

`PetScreen.tsx:213` (banner de actividad, `bottom-4` centrado) y `PetScreen.tsx:223` (lista de necesidades, `bottom-4 right-4`) están posicionados en el mismo contenedor a la misma altura. Con 4 necesidades activas y una actividad en curso, en pantallas pequeñas se pisan.

### U-7 · Datos ricos que nunca se muestran

Se persisten pero no se pintan en ningún sitio:

- **`lastSyncedBy`** — es el dato más valioso de una app para pareja. *"Ana alimentó a Pocky hace 5 min"* es la funcionalidad que da sentido al concepto "para dos". Hoy solo sirve para depurar.
- **`totalCaresGiven`** — contador acumulado invisible.
- **`createdAt`** — se usa para la edad, bien, pero no hay ningún hito ni celebración.

Es la mejora de producto de mayor retorno del proyecto: convertir `lastSyncedBy` + un historial corto de eventos en un feed de "quién cuidó a Pocky".

### U-8 · No hay pantalla de bienvenida ni onboarding de notificaciones

Ligado a C-3: sin explicación previa, el prompt del sistema aparece a ciegas. Un paso previo ("Activa los avisos para que Pocky pueda pedirte ayuda") multiplica la tasa de aceptación y evita quemar el permiso.

### U-9 · Detalles del manifest

`public/manifest.json`:
- `"purpose": "any maskable"` en el mismo icono está desaconsejado: un icono maskable usado como `any` se renderiza con padding extra. Declarar dos entradas separadas.
- Faltan `id` (recomendado para identidad estable de la PWA), `scope`, `lang`, `dir` y `screenshots` (necesarias para el prompt de instalación enriquecido en Android).
- No hay splash screens de iOS (`apple-touch-startup-image`), así que el arranque muestra un flash blanco.

### U-10 · No hay estado de "muerte" ni recuperación

`health` puede llegar a 0 sin ninguna consecuencia definida: la mascota simplemente se queda en `mood: 'sick'`. No hay mecánica de recuperación específica (solo `bathe` +5 y `walk` +5 de salud), ni feedback de gravedad. Combinado con C-2, la salud llega a 0 a diario y el estado deja de significar nada.

### U-11 · Cabeceras de seguridad incompletas

`next.config.ts:12`: `X-XSS-Protection: 1; mode=block` está **deprecado** y en ciertos navegadores antiguos introduce vulnerabilidades; la guía actual es omitirlo o mandar `0`. Falta lo que sí importa: `Content-Security-Policy`, `Referrer-Policy` y `Permissions-Policy`.

---

## 8. Código muerto y deuda

| Elemento | Ubicación | Nota |
|----------|-----------|------|
| `PetStats.tsx` | archivo completo (50 L) | Reemplazado por `CircularStats`. No se importa. |
| `ActionPad.tsx` | archivo completo (67 L) | La rejilla de acciones está inlineada en `PetScreen.tsx:251-296`. No se importa. |
| `firebaseAdmin.ts` | archivo completo (15 L) | `route.ts` define su propio `getAdminApp()`. Además usa `FIREBASE_PROJECT_ID` mientras `route.ts:14` usa `NEXT_PUBLIC_FIREBASE_PROJECT_ID` — dos variables distintas para lo mismo. |
| `requestFCMToken()` | `messaging.ts:78-84` | "Compatibilidad con el código existente" que ningún código existente usa. |
| `MOOD_BG` | `sprites.ts:59-66` | No se importa. |
| `SPRITES` (ASCII) | `sprites.ts:3-48` | Solo alcanzable para `bathing`/`walking`/`eating`/`sleeping`. `idle` usa PNG y `playing` usa Lottie. 45 líneas para 4 estados transitorios de 3 s. |
| `bgClass` | `timeBackground.ts` | Siempre `''` en las cuatro ramas. |
| `color` (prop) | `CircularStats.tsx:7,12` | Declarada en la interfaz y pasada 5 veces; no se desestructura ni se usa. |
| `label` (prop) | `CircularStats.tsx` | Sí se usa. ✅ |
| `age` | `types/pet.ts:23` | Ver A-9. |
| `emoji` en `PetNeed` | `types/pet.ts:7` | Ver A-10. |
| `/sw.js` en headers | `next.config.ts:18` | El archivo no existe. Ver U-1. |
| `.env.example` | referenciado en `README.md:65,87` | **No existe en el repo.** Y `.gitignore` incluye `.env*`, que lo ignoraría aunque se creara. Cambiar a `.env*` + `!.env.example`. |

**Sin tests, sin CI, sin type-check en el pipeline.** Para `petLogic.ts` —funciones puras, sin dependencias— unos tests unitarios son baratos y cubrirían el balanceo, `applyTick` con relojes desviados y los umbrales de `getNeeds`.

---

## 9. Documentación desincronizada

`README.md` y `AGENTS.md` describen una aplicación que no coincide con el código:

| Afirmación | Ubicación | Realidad |
|-----------|-----------|----------|
| "Vercel Cron cada hora" | `README.md:13,215`, `AGENTS.md:32` | `vercel.json` → una vez al día |
| "hunger −= mins * 1.04" | `AGENTS.md:33` | `petLogic.ts:37` → `mins * 0.13` (8× de diferencia) |
| Tabla de tasas: 0,8/min hambre, 0,5/min felicidad… | `README.md:203-211` | Reales: 0,13 / 0,195 / 0,13 / 0,156 |
| "Notificaciones push (próximamente)" | `README.md:14` | Implementadas (con los defectos de §4) |
| Roadmap: fases 2–6 en 🔜 | `README.md:189-197` | 2, 3 y 6 están hechas |
| Estructura `pocky-next/`, `.env.example`, `icon-192.png` | `README.md:32-67` | La carpeta es `Pocky/`, no hay `.env.example`, los iconos son `iconoPwa-192.png` |
| "Mascota con ASCII art animado" como característica principal | `README.md:9` | El estado principal (`idle`) es un PNG; `playing` es Lottie |
| Falta documentar `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `README.md:265-275` | Son obligatorias o el endpoint se cae (C-5) |

---

## 10. Plan de acción priorizado

### Sprint 1 — Desbloquear (la app hoy no cumple su función)

1. **C-1** Actividad con vencimiento (`activityUntil`) + parche defensivo en `applyTick`. *La app puede quedar inservible; va primero.*
2. **C-3** Quitar la petición automática de permiso; dejar solo el botón, con detección de `standalone` en iOS.
3. **C-4** Separar los `try` de FCM y Web Push; enrutar WebKit directo a push nativo.
4. **C-5** Mover `setVapidDetails` dentro del handler con guarda.
5. **4.2** Pasar `vapidKey` explícito a `getToken()`.

*Resultado: notificaciones funcionando en iPhone y ningún estado irrecuperable.*

### Sprint 2 — Frecuencia y consistencia

6. **C-2** Scheduler externo (o plan Pro) para tick horario + rebalancear las tasas de degradación.
7. **C-7** `arrayUnion`/`arrayRemove` o migración a subcolección `subscriptions/`.
8. **C-6** Anonymous Auth + reglas cerradas + sacar los tokens del documento público.
9. **A-3/A-4** Timestamp de servidor y acotado de `mins`.
10. **A-5** Guarda en `wakeUp` y bonus proporcional al sueño.

### Sprint 3 — Calidad de notificaciones y UX

11. **4.1** Un solo service worker (o scopes separados) + `skipWaiting`/`clients.claim`.
12. **4.3/4.4** `notificationclick` que enfoca, `tag` estable, `data.url`, y **acciones "Alimentar"/"Jugar" desde la notificación**.
13. **4.6** Necesidad y aviso por salud baja.
14. **4.7** Mensaje priorizado en vez de concatenación.
15. **U-1** Precaché del app shell.
16. **U-7** Mostrar `lastSyncedBy` y `totalCaresGiven` — *"Ana cuidó a Pocky hace 5 min"*.

### Sprint 4 — Limpieza

17. **A-1/A-2** Allowlist de campos persistidos + tabla de acciones (elimina ~120 líneas).
18. **R-1/R-2** Selectores de Zustand + `useMemo` en las estrellas.
19. Borrar los tres archivos muertos, `age`, `emoji`, `bgClass`, `color`, la cabecera `/sw.js`.
20. **A-12** Unificar la versión de Tailwind.
21. Crear `.env.example` (y arreglar el `.gitignore`), sincronizar `README.md` y `AGENTS.md`.
22. Tests unitarios de `petLogic.ts`.

---

## Anexo · Índice de hallazgos

| ID | Título | Severidad | Archivo principal |
|----|--------|-----------|-------------------|
| C-1 | Deadlock permanente de actividad | 🔴 Crítica | `store/petStore.ts:131` |
| C-2 | Cron diario en vez de horario | 🔴 Crítica | `vercel.json` |
| C-3 | Permiso de notificaciones sin gesto | 🔴 Crítica | `components/PetScreen.tsx:80` |
| C-4 | Fallback Web Push inalcanzable | 🔴 Crítica | `lib/messaging.ts:12` |
| C-5 | `setVapidDetails` a nivel de módulo | 🔴 Crítica | `app/api/cron/tick/route.ts:24` |
| C-6 | Firestore sin autenticación | 🔴 Crítica | `firestore.rules` |
| C-7 | Race condition en tokens push | 🔴 Crítica | `store/petStore.ts:61` |
| 4.1 | SWs compitiendo por el scope `/` | 🟠 Alta | `lib/messaging.ts:34,48` |
| 4.2 | `getToken()` sin `vapidKey` | 🟠 Alta | `lib/messaging.ts:37` |
| 4.3 | `notificationclick` abre ventana nueva | 🟡 Media | `public/sw-push.js:24` |
| 4.4 | Notificaciones sin `tag`/`data`/`actions` | 🟡 Media | `route.ts:78` |
| 4.5 | SW sin `skipWaiting`/`claim` | 🟡 Media | `public/sw-push.js` |
| 4.6 | Sin aviso por salud baja | 🟠 Alta | `lib/petLogic.ts:17` |
| 4.7 | Cuerpo del mensaje concatenado | 🟡 Media | `route.ts:79` |
| 4.8 | Doble escritura por tick | 🟢 Baja | `route.ts:56,137` |
| 4.9 | Sin `runtime` explícito | 🟢 Baja | `route.ts` |
| A-1 | Estado de UI persistido en la BD | 🟠 Alta | `store/petStore.ts:109` |
| A-2 | Duplicación en las acciones | 🟠 Alta | `store/petStore.ts` |
| A-3 | Reloj del cliente como verdad | 🟠 Alta | `lib/petLogic.ts:31` |
| A-4 | Degradación aplicada dos veces | 🟠 Alta | `store/petStore.ts:257` |
| A-5 | Exploit de energía infinita | 🟠 Alta | `store/petStore.ts:240` |
| A-6 | `pets/pocky` duplicado | 🟢 Baja | `petStore.ts:18`, `route.ts:39` |
| A-7 | `export let app: any` | 🟡 Media | `lib/firebase.ts:14` |
| A-8 | Caché sin gestor multipestaña | 🟡 Media | `lib/firebase.ts:25` |
| A-9 | Campo `age` muerto | 🟢 Baja | `types/pet.ts:23` |
| A-10 | `PetNeed.emoji` sin uso | 🟢 Baja | `types/pet.ts:7` |
| A-11 | Errores de escritura invisibles | 🟡 Media | `store/petStore.ts:56` |
| A-12 | Tailwind v3 + v4 mezclados | 🟡 Media | `package.json` |
| R-1 | Suscripción al store completo | 🟠 Alta | `components/PetScreen.tsx:54` |
| R-2 | `Math.random()` en render | 🟡 Media | `components/PetScreen.tsx:138` |
| R-3 | `setTimeout` sin limpiar | 🟡 Media | `store/petStore.ts` |
| R-4 | `actions` recreado por render | 🟢 Baja | `components/PetScreen.tsx:103` |
| R-5 | SSR desactivado por completo | 🟢 Baja | `components/PetScreen.tsx:119` |
| R-6 | JSON de Lottie en el bundle principal | 🟢 Baja | `components/PetAvatar.tsx:5` |
| U-1 | PWA sin soporte offline | 🟠 Alta | `next.config.ts:18` |
| U-2 | `alert()` como feedback | 🟡 Media | `components/PetScreen.tsx:66` |
| U-3 | Zoom bloqueado (WCAG 1.4.4) | 🟡 Media | `app/layout.tsx:43` |
| U-4 | Mascota no accesible por teclado | 🟡 Media | `components/PetScreen.tsx:206` |
| U-5 | `img { pointer-events: none }` global | 🟢 Baja | `app/globals.css:34` |
| U-6 | Solapamiento de alertas | 🟢 Baja | `components/PetScreen.tsx:213` |
| U-7 | `lastSyncedBy` nunca se muestra | 🟠 Alta (producto) | `components/PetScreen.tsx` |
| U-8 | Sin onboarding de notificaciones | 🟡 Media | — |
| U-9 | Detalles del manifest | 🟢 Baja | `public/manifest.json` |
| U-10 | Sin mecánica de muerte/recuperación | 🟡 Media | `lib/petLogic.ts` |
| U-11 | Cabeceras de seguridad incompletas | 🟢 Baja | `next.config.ts:12` |
