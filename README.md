# 🐰 Pocky — Mascota Virtual para Dos

Una mascota virtual compartida entre dos personas, construida con Next.js PWA + Firebase.
Funciona en iPhone (Safari) y Android, sin costo alguno.

---

## ✨ Características

- 🐰 Mascota con imagen, animación Lottie y sprites ASCII para los estados de actividad
- 💾 Sincronización en tiempo real entre dos teléfonos (Firestore)
- 📱 PWA — se instala en iPhone desde Safari sin App Store
- ⏰ Degradación 24/7 aunque nadie tenga la app abierta (cron horario externo)
- 🔔 Notificaciones push cuando la mascota necesita algo (Web Push, iOS incluido)
- 📴 Funciona sin conexión: shell cacheado + persistencia local de Firestore

---

## 🏗️ Arquitectura

```
iPhone (PWA)  ──┐
                ├──→ Firestore ←── cron-job.org (cada hora)
Android       ──┘     (estado base)      (degrada + notifica)
```

### El principio central

**Firestore guarda el estado BASE en un instante T, no "lo que se ve ahora".**
La pantalla muestra siempre `projectPet(base, ahora)`, una función pura.
Toda escritura es una transacción sobre el documento fresco.

Esto es lo que garantiza que ambos teléfonos vean exactamente lo mismo: misma
entrada + misma función + misma hora = mismo resultado. No hay copias locales
que puedan divergir, ni escrituras que se pisen entre sí.

---

## 📁 Estructura

```
Pocky/
├── src/
│   ├── app/
│   │   ├── layout.tsx                 ← metadatos PWA
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   └── api/cron/tick/route.ts     ← degradación + push (cron horario)
│   ├── components/
│   │   ├── PetScreen.tsx              ← pantalla principal
│   │   ├── PetAvatar.tsx              ← imagen / Lottie / ASCII
│   │   ├── CircularStats.tsx          ← anillos de estado
│   │   └── Toast.tsx
│   ├── hooks/
│   │   ├── usePetSync.ts              ← listener + reloj + refresco al volver
│   │   └── usePush.ts                 ← permiso y alta de notificaciones
│   ├── store/petStore.ts              ← espejo del documento + transacciones
│   ├── lib/
│   │   ├── petLogic.ts                ← proyección pura, RATES, ACTIONS
│   │   ├── petLogic.test.ts           ← 35 tests
│   │   ├── petDoc.ts                  ← normalización del documento
│   │   ├── auth.ts                    ← sesión anónima
│   │   ├── messaging.ts               ← Web Push
│   │   ├── firebase.ts
│   │   ├── sprites.ts / timeBackground.ts / random.ts
│   └── types/pet.ts
├── public/
│   ├── sw.js                          ← service worker único
│   ├── manifest.json
│   └── icons/
├── scripts/migrate.mjs                ← migración del esquema antiguo
└── firestore.rules
```

---

## 🚀 Setup

### Requisitos
- Node.js 20.9+
- Cuenta de Firebase (gratis) y de Vercel (gratis)

### 1. Dependencias

```bash
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

Rellena `.env.local` siguiendo los comentarios del archivo. Para las claves VAPID:

```bash
npx web-push generate-vapid-keys
```

### 3. Desarrollo

```bash
npm run dev
```

---

## 🔥 Configurar Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) → **Crear proyecto**
2. **Firestore Database** → Crear base de datos
3. **Authentication** → Sign-in method → **habilitar “Anónimo”**
   ⚠️ Sin esto la app no arranca: las reglas exigen sesión.
4. Icono `</>` (Web) → registrar app → copiar la config a `.env.local`
5. **Configuración > Cuentas de servicio** → Generar clave privada → copiar
   `project_id`, `client_email` y `private_key` a `.env.local`
6. Publicar las reglas:
   ```bash
   npx firebase deploy --only firestore:rules
   ```

---

## ☁️ Deploy en Vercel

1. Importa el repo en [vercel.com](https://vercel.com)
2. Añade **todas** las variables de `.env.local` en Environment Variables
3. Deploy

---

## ⏰ Cron horario (scheduler externo)

El tick lo dispara un servicio de cron externo — [cron-job.org](https://cron-job.org).

**No hay `vercel.json` a propósito.** El plan Hobby de Vercel limita los cron
jobs a **una ejecución diaria**, y declarar `"0 * * * *"` hace fallar el deploy.
Con un tick diario, además, la mascota llega a 0 en todos los stats cada día y
solo puede avisar una vez cada 24 h.

### Configuración en cron-job.org

| Campo | Valor |
|-------|-------|
| **URL** | `https://tu-dominio.com/api/cron/tick` |
| **Schedule** | cada hora, minuto 0 |
| **Request method** | `GET` |

Y en **Advanced → Headers**, añade:

```
Authorization: Bearer TU_CRON_SECRET
```

### Si el scheduler no permite cabeceras

Algunos servicios gratuitos no dejan añadir cabeceras. En ese caso el endpoint
acepta el secreto por query string:

```
https://tu-dominio.com/api/cron/tick?key=TU_CRON_SECRET
```

Funciona igual, pero **es menos seguro**: el secreto queda escrito en los
registros de acceso del scheduler y del hosting. Usa la cabecera siempre que
puedas.

### Comprobar que funciona

```bash
curl -i -H "Authorization: Bearer TU_CRON_SECRET" https://tu-dominio.com/api/cron/tick
```

Responde `{"success":true,...}`. Un `401` significa que el secreto no coincide
con la variable `CRON_SECRET` de Vercel.

> Si algún día pasas al plan Pro de Vercel, puedes volver a crear `vercel.json`
> con `{"crons":[{"path":"/api/cron/tick","schedule":"0 * * * *"}]}` y apagar el
> servicio externo. Vercel envía la cabecera `Authorization` automáticamente.

---

## 🔄 Migración desde el esquema anterior

Solo si vienes de una versión previa a la refactorización del estado:

```bash
npm run migrate -- --dry-run   # ver qué haría
npm run migrate                # conservando los stats actuales
npm run migrate -- --reset     # empezando de cero
```

Ejecútalo en la misma ventana en que despliegas el código nuevo.
Las suscripciones push antiguas se descartan: cada dispositivo se resuscribe
solo la próxima vez que abra la app, sin volver a pedir permiso.

---

## 📱 Instalar en iPhone

1. Abre Safari → entra a tu dominio
2. Botón de compartir ⬆ → **“Agregar a pantalla de inicio”**

Las notificaciones en iOS **solo funcionan con la app instalada así**. La app lo
detecta y te lo indica si intentas activarlas desde el navegador.

---

## 🎮 Mecánicas

### Estadísticas (0–100)

| Stat | Baja | Sube con |
|------|------|----------|
| 🍖 Hambre | −0,045/min (~37 h) | Alimentar (+15), golosina (+25) |
| 😊 Felicidad | −0,055/min (~30 h) | Jugar (+15), pasear (+20), golosina (+10) |
| 🫧 Limpieza | −0,035/min (~48 h) | Bañar (+40) |
| ⚡ Energía | −0,05/min (~33 h) | Dormir (+0,8/min) |
| ❤️ Salud | −0,2/min si 2+ stats < 20 | +0,1/min si todo va bien; bañar y pasear (+5) |

Todos los números viven en `RATES` y `ACTIONS` (`src/lib/petLogic.ts`).

### Sueño

La energía se recupera **por tiempo dormido**, no por pulsar “Despertar”.
Un ciclo completo son unas 2 horas. Mientras duerme, la felicidad y la limpieza
se congelan y el hambre baja más despacio. Al llegar a 100 se despierta solo.

### Estados de ánimo

| Mood | Condición |
|------|-----------|
| 😸 Feliz | Promedio > 80 |
| 😐 Neutral | 60–80 |
| 🥺 Triste | 30–60 |
| 🤒 Enfermo | Salud < 30 o promedio < 30 |
| 😴 Durmiendo | `isAsleep` |

### Notificaciones

El cron revisa cada hora si hay necesidades urgentes (incluida la salud baja) y
manda **como máximo un aviso cada 4 horas**, priorizando la necesidad más grave.

---

## 🧪 Verificación

```bash
npm test && npm run typecheck && npx eslint src && npm run build
```

---

## 🗺️ Pendiente

- Nombre y especie configurables desde la UI
- Historial de cuidados (hoy solo se muestra el último)
- Acciones desde la propia notificación (“Alimentar” / “Jugar”)
- Tests de las reglas de Firestore con `@firebase/rules-unit-testing`
- Splash screens de iOS

---

## 📝 Licencia

Proyecto personal — hecho con 🐰 y mucho amor.
