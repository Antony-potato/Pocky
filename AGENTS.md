# Agent Directives for Pocky

## 🤖 Rol
Desarrollador full-stack sobre Next.js (App Router), Firebase (Firestore, Auth, Admin SDK) y PWA.
Objetivo: mantener y ampliar esta mascota virtual compartida garantizando que **los dos teléfonos vean siempre lo mismo**.

## 📁 Contexto
- **Proyecto:** Pocky — Mascota Virtual para Dos
- **Stack:** Next.js 16 (App Router), Firestore, Firebase Anonymous Auth, Web Push (VAPID), Zustand, Lucide React, Tailwind CSS v3
- **Plataforma:** PWA mobile-first, pensada para instalarse en la pantalla de inicio

## 🛠️ Comandos
```bash
npm install
npm run dev
npm run build
npm test          # vitest — lógica pura
npm run typecheck
npm run migrate    # migración del documento (una sola vez)
```
Cron manual: `GET /api/cron/tick` con `Authorization: Bearer $CRON_SECRET`.

## 🧠 EL principio de arquitectura (lo más importante)

> **Firestore guarda el estado BASE en un instante T. Todo lo que se ve es
> `projectPet(base, now)`, una función pura. Toda escritura es una transacción.**

De aquí se derivan reglas que **no deben romperse**:

1. **Nada mutado localmente.** El store (`petStore.ts`) es un espejo: `remote` solo lo escribe `onSnapshot`, `now` solo lo escribe `tickClock()`. El "tick" **no degrada stats**, solo avanza el reloj y provoca una re-proyección.
2. **Nada derivado se persiste.** `mood`, `needs` y la edad se calculan al proyectar. Escribirlos al documento está prohibido por las reglas de Firestore.
3. **Toda mutación va en `runTransaction`.** Se lee el documento fresco dentro de la transacción y se valida contra su proyección, nunca contra la copia local. Sin esto vuelven las sobrescrituras entre los dos usuarios.
4. **`lastUpdated` siempre con `serverTimestamp()`.** El reloj del cliente solo se usa para *pintar*, con la proyección acotada a `[0, MAX_PROJECTION_MIN]`.
5. **La actividad se deriva de `activityUntil`**, nunca de un `setTimeout` que escriba `idle` más tarde. Si la app se cierra a mitad de una acción, la actividad debe expirar sola en ambos dispositivos.
6. **Las recompensas son función del tiempo, no de pulsar un botón.** Despertar no da energía: la da haber dormido (`RATES.sleepRegen`). Cualquier bonus fijo por acción reintroduce un exploit.

## 🎮 Balanceo
Todo vive en `RATES` y `ACTIONS` dentro de `petLogic.ts`. Ajustar el juego = editar esos números y actualizar los tests. No dispersar constantes por los componentes.

## 🔔 Notificaciones
- **Un solo transporte:** Web Push estándar (VAPID). Cubre Chrome, Firefox, Edge, Android y Safari/iOS 16.4+. **No reintroducir FCM**: obligaba a un segundo service worker en el mismo scope y cada uno desinstalaba al otro.
- **Un solo service worker:** `public/sw.js` (shell offline + push + notificationclick).
- **El permiso solo se pide desde un gesto del usuario** (el botón 🔔). WebKit lo exige, y un `denied` es permanente.
- En iOS el push solo funciona con la PWA **instalada en la pantalla de inicio**; `getNotificationState()` devuelve `needs-install` para poder explicarlo.
- El cron envía como máximo un aviso cada 4 h (`NOTIFICATION_COOLDOWN_MS`).

## 🔒 Seguridad
- Firestore exige sesión (Anonymous Auth). **Hay que activar Authentication > Sign-in method > Anonymous** en la consola.
- Las suscripciones push viven en `pets/pocky/subscriptions/{uid}` con `allow read: if false`. Solo el Admin SDK del cron las lee. Nunca devolverlas al cliente.
- `firebase-admin` no funciona en edge runtime: mantener `export const runtime = 'nodejs'`.

## 🎨 UI
1. **Iconos:** solo `lucide-react`, con color contextual.
2. **Mascota:** una sola imagen grande centrada, sin recuadro, con drop-shadow y animaciones CSS.
3. **HUD:** stats flotantes compactos con glassmorphism (`bg-white/70 backdrop-blur-md`).
4. **Acciones:** panel inferior con esquinas superiores redondeadas (`rounded-t-[2rem]`).
5. **Layout:** siempre `h-dvh`, nunca `h-screen`.
6. **Sin `Math.random()` en render** — React lo prohíbe y provoca saltos visuales. Usar `makeRng()` de `lib/random.ts`.
7. **Sin `alert()`** — usar `showToast()` del store.
8. **No bloquear el zoom** (WCAG 1.4.4).

## 🗂️ Dónde está cada cosa
| Archivo | Responsabilidad |
|---------|-----------------|
| `src/lib/petLogic.ts` | Proyección pura, RATES, ACTIONS, moods y needs |
| `src/lib/petDoc.ts` | Normalización del documento + ruta única `PET_DOC_PATH` |
| `src/store/petStore.ts` | Espejo del documento + acciones transaccionales |
| `src/hooks/usePetSync.ts` | Listener + reloj + refresco al volver de background |
| `src/hooks/usePush.ts` | Estado del permiso y alta de suscripción |
| `src/lib/messaging.ts` | Web Push: permiso, service worker, suscripción |
| `src/lib/auth.ts` | Sesión anónima; el UID es la identidad del dispositivo |
| `src/app/api/cron/tick/route.ts` | Tick horario + envío de push |
| `public/sw.js` | Service worker único |
| `scripts/migrate.mjs` | Migración del esquema antiguo |

## ✅ Antes de dar algo por terminado
```bash
npm test && npm run typecheck && npx eslint src && npm run build
```
Si tocas `petLogic.ts`, añade o ajusta tests: es la única pieza de la que depende que ambos teléfonos coincidan.
