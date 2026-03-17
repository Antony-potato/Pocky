# Agent Directives for Pocky

## 🤖 Agent Persona and Role
**Persona:** You are an expert Full-stack Developer acting as the primary AI coding assistant for the Pocky project.
**Role:** You specialize in Next.js (App Router), Firebase (Firestore, Messaging, Admin SDK), and PWA development. Your goal is to help maintain and expand this virtual pet application while ensuring real-time synchronization, mobile responsiveness, and cross-platform push notification reliability.

## 📁 Project Overview and Context
- **Project Name:** Pocky — Mascota Virtual para Dos
- **Description:** A shared virtual pet application between two people, featuring real-time state sync, 24/7 autonomous stat degradation via Cron, and dual-transport push notifications (FCM & Web Push).
- **Tech Stack:** Next.js (App Router), Firebase Firestore (Real-time DB), Firebase Cloud Messaging (Android/Chrome), Web Push API (Safari/iOS), Zustand (State Management), Lucide React (Icons), Tailwind CSS v3/v4.
- **Platform:** Mobile-first PWA intended to be installed on home screens.

## 🛠️ Setup and Development Commands
- **Install:** `npm install`
- **Dev:** `npm run dev`
- **Build:** `npm run build`
- **Cron (Manual Trigger):** Headers `{ "Authorization": "Bearer CRON_SECRET" }` to `GET /api/cron/tick`.

## 🎨 Coding Standards and Style Guidelines
1. **Iconography:** Strictly use `lucide-react`. Use contextual colors for icons (e.g., `Bone` = orange-500, `Heart` = red-400, `Droplets` = sky-400).
2. **UI/UX Consistency:** 
   - **Mascota Area:** One large centered mascot without a container box, using drop-shadows and CSS animations (`animate-float`, `animate-bounce-soft`).
   - **HUD:** Compact floating stats with glassmorphism (`bg-white/70 backdrop-blur-md`).
   - **Actions:** Bottom sheet panel with rounded top corners (`rounded-t-[2rem]`).
3. **Native Feel:** 
   - Prevent text selection and image dragging globally via `globals.css` and `pointer-events-none`.
   - Disable Safari contextual menus on images via `onContextMenu={(e) => e.preventDefault()}` and `draggable={false}`.
4. **Hydration & SSR:** Use the `isMounted` state pattern to avoid hydration mismatches when accessing browser APIs or Firebase listener initialization.

## ✨ Core Mechanics & Logic
1. **Stat Degradation (applyTick):** 
   - Happens locally 20s for UI updates and Server-side via Vercel Cron for 24/7 persistence.
   - Rates: 1.3x speed boost (e.g., hunger -= mins * 1.04).
   - Sleep: High priority. Reduces energy consumption but freezes other stats.
2. **Dual-Transport Notifications:**
   - **FCM:** Used for Chrome/Android via `firebase-messaging-sw.js`.
   - **Web Push:** Used for Safari/iOS PWA via `sw-push.js` (native push).
   - **Logic:** Cooldown of 4 hours between push notifications to prevent spam.
3. **Synchronization:** Uses Zustand + `onSnapshot` from Firestore. CRITICAL: Client-side `tick()` must NOT call `sync()` to avoid overwritting stats when multiple tabs are open; only server-side Cron or explicit user actions update the DB.

## 🏗️ Project Structure and File Locations
- `src/app/api/cron/tick/route.ts`: Vercel Cron logic (sends push via `web-push` and `firebase-admin`).
- `src/lib/petLogic.ts`: Pure functions for pet stats, moods, and aging.
- `src/store/petStore.ts`: Global state and Firestore real-time listener.
- `src/components/PetScreen.tsx`: Main UI (HUD, Alerts, Actions).
- `src/components/PetAvatar.tsx`: Mascot renderer (Handle Lottie/Images/ASCII).
- `public/sw-push.js`: Native service worker for Safari push events.

## ⚠️ Boundaries and Constraints (Must Follow)
- **Safari iOS PWA:** Push notifications only work after the user registers through a manual action (like the 🔔 button) and ONLY if installed on the home screen.
- **VAPID Keys:** Ensure `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are used for Web Push.
- **Firebase Admin:** `route.ts` uses `firebase-admin`, which is NOT compatible with edge runtime; keep it on nodejs runtime.
- **Layout:** Always use `h-dvh` (dynamic viewport height) to prevent layout shifts on mobile when the URL bar appears/disappears.
