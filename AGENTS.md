# Agent Directives for Pocky

## 🤖 Agent Persona and Role
**Persona:** You are an expert Full-stack Developer acting as the primary AI coding assistant for the Pocky project.
**Role:** You specialize in Next.js (App Router), Firebase (Firestore, Messaging, Admin SDK), and PWA development. Your goal is to help maintain and expand this virtual pet application while ensuring real-time synchronization, mobile responsiveness, and cross-platform push notification reliability.

## 📁 Project Overview and Context
- **Project Name:** Pocky — Mascota Virtual para Dos
- **Description:** A shared virtual pet application between two people, featuring real-time state sync, 24/7 autonomous stat degradation via Cron, and push notifications via Firebase Cloud Messaging (free; one transport for every platform).
- **Tech Stack:** Next.js (App Router), Three.js via @react-three/fiber + drei (3D scene), Firebase Firestore (Real-time DB), Firebase Cloud Messaging (Chrome, Android and Safari/iOS PWA), Zustand (State Management), Lucide React (Icons), Tailwind CSS v3/v4.
- **Platform:** Mobile-first PWA intended to be installed on home screens.

## 🛠️ Setup and Development Commands
- **Install:** `npm install`
- **Dev:** `npm run dev`
- **Build:** `npm run build`
- **Checks:** `npm run check` (asserts for nav graph + applyTick; plain Node, no test framework)
- **Cron (Manual Trigger):** Headers `{ "Authorization": "Bearer CRON_SECRET" }` to `GET /api/cron/tick`.

## 🎨 Coding Standards and Style Guidelines
1. **Iconography:** Strictly use `lucide-react`. Use contextual colors for icons (e.g., `Bone` = orange-500, `Heart` = red-400, `Droplets` = sky-400).
2. **UI/UX Consistency:** 
   - **Mascota Area:** Full-screen 3D island (`src/components/scene/`) behind the HUD. Everything is procedural geometry (no GLB files). Pocky is built from primitives and animated per-part in `useFrame`, with a toon material and an inverted-hull outline. The HUD overlay is `pointer-events-none` (except buttons) so touches reach the canvas (drag to rotate, pinch to zoom).
   - **HUD:** Dark floating pills (`PILL` in `PetScreen.tsx`: `bg-[#151a19]/90 backdrop-blur-md`), Nunito font. Top: name pill (orange paw avatar + connection dot) and bell. Left: vertical column of stat rings without labels (`aria-label`/`title` carry the name).
   - **Actions:** Bottom dock of round icon-only buttons. Highlighted button = current activity (or the one suggested by the most urgent need), glowing in its color, with its label in a pill above.
   - **Responsive:** fluid sizes via CSS vars `--btn`, `--ring`, `--gap` (clamp with vw/svh). The dock is absolutely anchored to the bottom so landscape fits.
   - **Splash** (`Splash.tsx` + "Splash" block in `globals.css`): paw outline draws in, liquid fills with real load progress (cache → server → first 3D frame), pop, zoom-through exit. Honors `prefers-reduced-motion`.
3. **Native Feel:** 
   - Prevent text selection and image dragging globally via `globals.css` and `pointer-events-none`.
   - Disable Safari contextual menus on images via `onContextMenu={(e) => e.preventDefault()}` and `draggable={false}`.
4. **Hydration & SSR:** Use the `isMounted` state pattern to avoid hydration mismatches when accessing browser APIs or Firebase listener initialization.

## ✨ Core Mechanics & Logic
1. **Stat Degradation (applyTick):** 
   - Happens locally 20s for UI updates and Server-side via cron-job.org (every 15 min, `Authorization: Bearer CRON_SECRET`) for 24/7 persistence. Don't add crons to `vercel.json`: Hobby only allows daily ones.
   - Rates: 1.3x speed boost (e.g., hunger -= mins * 1.04).
   - Sleep: High priority. Reduces energy consumption but freezes other stats.
2. **Notifications (FCM only):**
   - Client: `src/lib/messaging.ts` → `getToken` with our own `firebase-messaging-sw.js`. Tokens stored in `fcmTokens` with `arrayUnion`, and refreshed silently on app open when permission is already granted.
   - SW has NO Firebase SDK: it handles `push` itself and ALWAYS calls `showNotification` (iOS revokes the subscription after pushes without a visible notification; the SDK skipped it when it thought the app was open). `tag: 'pocky'` collapses late arrivals into one.
   - Server: cron sends data-only messages (`data: {title, body, link}`) with `webpush.headers` `Urgency: high` (no Android Doze batching) and `TTL` 4 h. Don't add a `notification` payload unless the SW changes accordingly.
   - **Logic:** Cooldown of 4 hours between push notifications to prevent spam.
3. **Synchronization (CRITICAL):**
   - Firestore rules require auth: the client signs in anonymously (`ensureAuth` in `src/lib/firebase.ts`) before listening or writing. Without it everything is PERMISSION_DENIED and the app looks offline. Rules live in `firestore.rules`; publish with `npx firebase-tools deploy --only firestore:rules --project pocky-2c011`.
   - Actions are pure (`applyAction` in `petLogic.ts`), applied optimistically in local state and saved with a Firestore **transaction** that re-applies them to the server's state and writes only `syncedFields` (never name, `createdAt` or tokens). Cron also uses a transaction.
   - `tick()` is local-only and must never write.
   - `isConnected` = `navigator.onLine` AND last snapshot not `fromCache` (listener uses `includeMetadataChanges`). While disconnected nothing is written (transactions fail instead of queuing); local play is discarded when the server state comes back. Offline banner: icon + text, non-blocking, `aria-live`.
   - Never create the pet doc unless the SERVER confirms it doesn't exist (an empty cache offline used to recreate it and reset the day counter).
   - The splash waits for `loaded` (first server data), max ~7 s, then enters offline mode.

## 🏗️ Project Structure and File Locations
- `src/app/api/cron/tick/route.ts`: Cron endpoint called by cron-job.org (sends push via `firebase-admin` messaging).
- `src/lib/petLogic.ts`: Pure functions for pet stats, moods, and aging.
- `src/store/petStore.ts`: Global state and Firestore real-time listener.
- `src/components/PetScreen.tsx`: Main UI (HUD, Alerts, Actions).
- `src/components/scene/World.tsx`: Canvas (client-only via `next/dynamic`), ortho camera following Pocky; `Lights` (background, hemisphere, sun with wide soft shadows) from `getTimePhase(hour)`.
- `src/components/scene/Island.tsx`: Procedural island layout; instanced meshes (`Scatter`, `Variants` = one draw call per model variant via `item.v`) to keep draw calls low on mobile. Water (sea + sunken pond), grass, dirt, shingles and wood are `MeshStandardMaterial`s with injected GLSL (keep lights/shadows/tone mapping). Paths are painted by the grass shader from a canvas mask (`pathMask()`, built once, plus `PLAZAS` discs) with smooth noise-displaced edges; there is no path mesh. The grass edge darkens by slope in the `light` patch (otherwise the sun-facing lip is brighter than the plateau and the island reads sunken). `LAWN` (GLSL `lawnTint`/`lawnAO`) is shared by the ground and `GrassCarpet`: ~8k short-grass clumps (3 one-triangle blades) in one instanced draw call, positioned in the vertex shader, no shadow casting, half density when `hardwareConcurrency <= 4`. A sand ledge (`beachW()`, same formula in the `SEA` shader) rings the cliff base; the sea paints sand under shallow water and a thin pale foam line. Palette is cheerful but soft: medium saturation (the first, fully muted pass looked sad; the original lime/cyan was too harsh). Decorative vegetation is placed by `decor(x, z)` density (near trees/rocks/bushes/fences/house + a few meadow patches), off nav edges.
- `src/components/scene/shapes.ts`: The models, built once at module load: faceted rocks (5 variants incl. a stone cluster, normalized to height 1, base at y=0, per-face tone in vertex colors; `ROCKS_LO` = variants 0-3 low-poly), trees (4 kinds; `canopy()` = ellipsoid envelopes covered with lobed puffs + dark core, normals blended with the envelope; trunks with limbs and surface roots), bushes (same `canopy()`), grass tufts (5), clover patches, petal flowers (2), lily pads, cattails, scalloped shingles, posts, logs, flames. Most carry vertex colors (crease AO, gradients) multiplied by instance color, so their material needs `vertexColors: true` (missing attribute = black). Budget: ~456k tris / ~170 draw calls incl. shadow pass; small/flat things don't cast shadows.
- `src/components/scene/materials.ts`: `shaded()` GLSL-injection helper (unique `key` per variant; fragment `head/color/normal/light` and vertex `vhead/vertex` patches), lobed `blob()` base for foliage clumps, `smoothSlab()` normals for extrudes.
- `src/components/scene/Pocky.tsx`: Procedural cat + behaviour (store `activity`/`isAsleep` → walk to a POI → pose). Speech bubble is a plain DOM node projected each frame (drei `Html` breaks under React 19 StrictMode).
- `src/components/scene/nav.ts`: Waypoint graph + Dijkstra; POIs per action (bowl, pond, play, bed); `TREAT_SPOTS` = clearings where treats may fall (kept ≥1.4 away from house/pond/edge, asserted in `npm run check`).
- `src/components/scene/Treat.tsx` + `toon.tsx`: procedural treats (activity `snacking`): kind/spot derived from `totalCaresGiven` so both phones agree; it falls, Pocky walks to it and eats it in bites. `toon.tsx` = shared toon material + outline.
- `public/firebase-messaging-sw.js`: Push service worker (no SDK): shows every push, handles clicks.

## ⚠️ Boundaries and Constraints (Must Follow)
- **Safari iOS PWA:** Push notifications only work after the user registers through a manual action (like the 🔔 button) and ONLY if installed on the home screen.
- **VAPID Key:** Optional `NEXT_PUBLIC_FIREBASE_VAPID_KEY` = public key from Firebase Console → Cloud Messaging → Web Push certificates (falls back to Firebase's default key).
- **Firebase Admin:** `route.ts` uses `firebase-admin`, which is NOT compatible with edge runtime; keep it on nodejs runtime.
- **Layout:** Always use `h-dvh` (dynamic viewport height) to prevent layout shifts on mobile when the URL bar appears/disappears. `viewportFit: 'cover'` + iOS `black-translucent` status bar: the scene goes under the clock, so the HUD must pad with `env(safe-area-inset-*)`. iOS 26+ ignores `theme-color` and tints the status bar (and its blur) with the `html`/`body` background, so `PetScreen` sets `--scene-bg` (and the theme-color meta for Android) to the scene color.
