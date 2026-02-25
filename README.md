# 🐰 Pocky — Mascota Virtual para Dos

Una mascota virtual compartida entre dos personas, construida con Next.js PWA + Firebase. Funciona en iPhone (Safari) y Android (APK con Capacitor), sin costo alguno.

---

## ✨ Características

- 🐰 Mascota con ASCII art animado (conejo, gato, perro, hámster)
- 💾 Sincronización en tiempo real entre dos teléfonos (Firebase)
- 📱 PWA — se instala en iPhone desde Safari sin App Store
- 📦 APK — se instala en Android sin Google Play
- ⏰ Degradación 24/7 aunque nadie tenga la app abierta (Vercel Cron)
- 🔔 Notificaciones push cuando la mascota necesita algo (próximamente)
- 🖼️ Widget en pantalla de inicio via Scriptable (próximamente)

---

## 🏗️ Arquitectura

```
iPhone (PWA Safari)  ──┐
                        ├──→ Firebase Firestore ←── Vercel Cron (cada hora)
Android (APK)        ──┘         (datos)              (degrada stats)
```

---

## 📁 Estructura del proyecto

```
pocky-next/
├── src/
│   ├── app/
│   │   ├── layout.tsx              ← PWA meta tags
│   │   ├── page.tsx                ← página raíz
│   │   ├── globals.css             ← Tailwind base
│   │   └── api/
│   │       └── cron/
│   │           └── tick/
│   │               └── route.ts   ← endpoint de degradación (Vercel lo llama cada hora)
│   ├── components/
│   │   ├── PetScreen.tsx           ← pantalla principal
│   │   ├── PetAvatar.tsx           ← ASCII art animado
│   │   ├── PetStats.tsx            ← barras de estado
│   │   └── ActionPad.tsx           ← botones de cuidado
│   ├── store/
│   │   └── petStore.ts             ← estado global + sync Firebase
│   ├── lib/
│   │   ├── firebase.ts             ← cliente Firebase
│   │   ├── petLogic.ts             ← lógica pura (compartida con cron)
│   │   └── sprites.ts              ← ASCII art y mensajes
│   └── types/
│       └── pet.ts                  ← tipos TypeScript
├── public/
│   ├── manifest.json               ← PWA manifest
│   └── icons/                      ← íconos de la app (agregar manualmente)
│       ├── icon-192.png
│       └── icon-512.png
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── vercel.json                     ← configura el cron job
├── .env.example                    ← plantilla de variables de entorno
└── .gitignore
```

---

## 🚀 Setup local

### Requisitos
- Node.js 20+
- Cuenta de Firebase (gratis)
- Cuenta de Vercel (gratis)

### 1. Instala dependencias

```bash
npm install
```

### 2. Configura variables de entorno

```bash
cp .env.example .env.local
```

Edita `.env.local` con tus credenciales:

```bash
# Cliente (Firebase Web) — desde console.firebase.google.com
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Servidor (Firebase Admin) — desde Configuración > Cuentas de servicio > Generar clave
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Cron — cualquier string largo y aleatorio
CRON_SECRET=pon_aqui_algo_largo_y_aleatorio
```

### 3. Corre en desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000)

---

## 🔥 Configurar Firebase

1. Ve a [console.firebase.google.com](https://console.firebase.google.com)
2. **Crear proyecto** → nombre `Pocky`
3. En el menú lateral → **Firestore Database** → **Crear base de datos** → modo prueba
4. En **Descripción general** → icono `</>` (Web) → registrar app → copiar config a `.env.local`
5. Para el cron: **⚙️ Configuración** → **Cuentas de servicio** → **Generar nueva clave privada** → copiar `project_id`, `client_email`, `private_key` a `.env.local`

---

## ☁️ Deploy en Vercel

### 1. Sube el código a GitHub

```bash
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/TU_USUARIO/pocky.git
git push -u origin main
```

### 2. Conecta con Vercel

1. Ve a [vercel.com](https://vercel.com) → **New Project** → importa tu repo
2. En **Environment Variables** agrega todas las variables de `.env.local`
3. En **Domains** conecta tu dominio propio
4. Deploy 🚀

El cron job (`vercel.json`) se activa automáticamente — Vercel llama a `/api/cron/tick` cada hora.

---

## 📱 Instalar en iPhone (PWA)

1. Abre Safari → entra a `tudominio.com`
2. Toca el botón de compartir `⬆`
3. **"Agregar a pantalla de inicio"**
4. Ponle el nombre `Pocky` → **Agregar**

La app aparece en tu pantalla de inicio como cualquier otra app.

---

## 🤖 Instalar en Android (APK con Capacitor)

> Próximamente — ver Fase 4 del roadmap

```bash
npm install @capacitor/core @capacitor/android
npx cap init
npm run build
npx cap add android
npx cap sync
npx cap open android   # abre Android Studio para generar el APK
```

---

## 🖼️ Widget con Scriptable (iPhone)

> Próximamente — ver Fase 5 del roadmap

Scriptable lee Firebase directamente y muestra el estado de Pocky en tu pantalla de inicio.

---

## 🗺️ Roadmap

| Fase | Estado | Descripción |
|------|--------|-------------|
| **1 — Base** | ✅ Lista | Mascota con stats, ASCII art, animaciones, Firebase sync |
| **2 — Deploy** | 🔜 | Vercel + tu dominio, cron de degradación 24/7 |
| **3 — PWA** | 🔜 | Instalar en iPhone desde Safari |
| **4 — APK Android** | 🔜 | Capacitor → APK con widget nativo |
| **5 — Widget iPhone** | 🔜 | Scriptable lee Firebase |
| **6 — Notificaciones** | 🔜 | Firebase Cloud Messaging push 24/7 |
| **7 — Personalización** | 🔜 | Nombre, especie, accesorios, historial |

---

## 🎮 Mecánicas de la mascota

### Estadísticas (0–100)

| Stat | Baja cuando... | Sube con... |
|------|---------------|-------------|
| 🍖 Hambre | Con el tiempo (0.8/min) | Alimentar, golosina |
| 😊 Felicidad | Con el tiempo (0.5/min) | Jugar, pasear, golosina |
| 🫧 Limpieza | Con el tiempo (0.3/min) | Bañar |
| ⚡ Energía | Jugando, paseando (0.4/min) | Durmiendo |
| ❤️ Salud | Si 2+ stats < 20 | Cuidado constante |

### Degradación 24/7

El Vercel Cron corre cada hora y aplica la degradación aunque nadie tenga la app abierta. Si stats caen bajo 20, se envía una notificación push.

### Estados de ánimo

| Mood | Condición |
|------|-----------|
| 😸 Feliz | Promedio stats > 80 |
| 😐 Neutral | Promedio 60–80 |
| 🥺 Triste | Promedio 30–60 |
| 🤒 Enfermo | Salud < 30 o promedio < 30 |
| 😴 Durmiendo | `isAsleep = true` |

---

## 🔧 Personalización rápida

### Cambiar especie o nombre inicial

Edita `src/lib/petLogic.ts`:

```ts
export const DEFAULT_PET: PetData = {
  name:    'Pocky',      // ← cambia el nombre
  species: 'bunny',      // ← 'bunny' | 'cat' | 'dog' | 'hamster'
  ...
}
```

### Cambiar ASCII art

Edita `src/lib/sprites.ts` — cada sprite es un string con `\n` entre líneas:

```ts
bunny: {
  idle: "(\\ /)\n( ._. )\nc( )( )",   // ← cambia esto
  happy: "(\\ /)\n( ^u^ )\nc( )( )",
  ...
}
```

### Cambiar velocidad de degradación

Edita `src/lib/petLogic.ts` en la función `applyTick`:

```ts
hunger = clamp(hunger - mins * 0.8);  // ← número más alto = baja más rápido
```

---

## 🛡️ Variables de entorno

| Variable | Dónde se usa | Descripción |
|----------|-------------|-------------|
| `NEXT_PUBLIC_FIREBASE_*` | Cliente (browser) | Conexión Firebase desde la app |
| `FIREBASE_PROJECT_ID` | Servidor (cron) | Firebase Admin SDK |
| `FIREBASE_CLIENT_EMAIL` | Servidor (cron) | Firebase Admin SDK |
| `FIREBASE_PRIVATE_KEY` | Servidor (cron) | Firebase Admin SDK |
| `CRON_SECRET` | Servidor (cron) | Protege el endpoint `/api/cron/tick` |

> ⚠️ Nunca subas `.env.local` a git — ya está en `.gitignore`

---

## 📝 Licencia

Proyecto personal — hecho con 🐰 y mucho amor.