# Plan: lo que le falta a Pocky

> **Estado:** terminado el 2026-10-24. Las 11 fases están en producción.
>
> **Decisiones:**
> - la racha cuenta si lo cuida cualquiera de los dos;
> - se duerme solo a la 1:00 y se levanta a las 8:00;
> - minijuego: lanzar la pelota en la isla.
>
> **Avance:** [x] 0 · [x] 1 (subidas juntas) · [x] 2 · [x] 3 · [x] 4 · [x] 5 · [x] 6 · [x] 7 · [x] 8 · [x] 9 · [x] 10

Lista pedida: silencio de noche, medicina con Pocky enfermo, historial, mimos, racha, cacas, accesorios,
noche (se duerme solo y se levanta de malas), avisar al otro y minijuegos.

Reglas para todas las fases:
- **Hora de Cancún** (`America/Cancun`, UTC−5 todo el año) para todo lo que dependa de la hora: silencio,
  noche y racha. Se calcula igual en los dos móviles y en el cron, que corre en UTC.
- **La lógica, pura en `petLogic.ts`**, como hasta ahora. Las acciones se aplican igual en local y en la
  transacción. Cada regla nueva lleva su `assert` en `npm run check`.
- **Reglas de Firestore sin cambios:** no limitan campos nuevos, así que no hay que publicar nada en la consola.
- **Al acabar cada fase:** `tsc` + `npm run check` + `next build` + commit.
- **Pruebas en el navegador sin conexión:** el `npm run dev` local usa el Pocky REAL de Firestore. Las pruebas
  visuales se hacen en modo sin conexión, para no tocar sus stats ni ensuciar el historial.

---

## Fase 0 · Base (la necesitan historial, avisos y racha)

- `src/lib/time.ts`: `cancunHour(now)` y `cancunDay(now)` → `'2026-10-24'`, con `Intl.DateTimeFormat`.
- **Quién es cada móvil:** la primera vez se pregunta "¿Cómo te llamas?" y se guarda en el doc
  `devices: { [deviceId]: { name, token? } }`. Ya existe `deviceId` en localStorage.
- **El token FCM pasa a `devices[id].token`**, para saber de quién es cada uno.
  - El cron envía a esos tokens, más `fcmTokens` (los viejos) mientras existan.
  - Los tokens muertos se borran en los dos sitios.

## Fase 1 · Silencio de noche · S

- El cron no avisa entre las 23:00 y las 8:00 (hora de Cancún).
- No toca `lastNotificationSent`, así que a las 8:00 sale el aviso pendiente.

## Fase 2 · Historial · M

- Cada acción guarda `{ by: deviceId, a, t }` en `log`, dentro de la misma transacción, con un máximo de 30
  entradas.
- **Botón de historial en el HUD**, junto a la campana, que abre un panel con frases como:
  - "Ana le dio de comer · hace 10 min"
  - "Tú lo bañaste · 18:05"
- Los nombres salen de `devices`.

## Fase 3 · Mimos · S

- Tocar a Pocky (ya salta y salen corazones) cuenta como mimo: +3 de felicidad.
- Cuenta como mucho uno cada 30 s, para que no se pueda abusar.
- No ocupa a Pocky: se puede dar mimos mientras come.
- En el historial se agrupan: "Ana le dio mimos" sale una vez cada 10 min como mucho.

## Fase 4 · Racha · S

- `streak` + `streakDay`: el día cuenta si alguien hizo al menos un cuidado ese día (hora de Cancún).
  - Si el último día con cuidado fue ayer, la racha suma 1.
  - Si fue antes, vuelve a 1.
- En la píldora del nombre: `🔥 12`.
- A las 20:00, si nadie lo ha cuidado hoy y la racha va en 2 o más, sale una notificación:
  "¡La racha de 12 días se pierde hoy!"

## Fase 5 · Avisar al otro · M

- En cada vuelta, el cron mira para cada móvil qué hizo el **otro** desde su último aviso, y le manda un
  resumen: "Ana cuidó a Pocky: 🍖 comida y 🛁 baño".
- Límites:
  - como mucho un resumen cada 30 min por móvil;
  - respeta el silencio de noche;
  - los mimos no se avisan.
- Cada tipo de aviso lleva su propio `tag` en el service worker (`necesidad`, `pareja`, `racha`), para que no
  se pisen entre ellos.

## Fase 6 · Medicina y Pocky enfermo · L

- **Enfermo** (salud < 30, mood `sick`):
  - se ve mareado: se balancea, tiene los ojos entornados y las mejillas verdosas;
  - le sale **una burbuja de moco** de la nariz que se infla y desinfla;
  - anda más despacio (eso ya existe).
- **Botiquín en la isla**: un armarito con cruz roja junto a la casa, hecho con primitivas como el resto, y un
  nodo nuevo `meds` en `nav.ts`.
- **Acción "Medicina"** (icono `Pill`):
  - el botón solo aparece cuando la salud baja de 50;
  - Pocky va al botiquín y se toma la medicina: 20 s, +40 de salud poco a poco, como las otras acciones;
  - se ajusta `--btn` para que quepan 7 botones en 320 px.
- **Nueva necesidad** "Pocky está enfermo 🤒" (crítica): avisa cada hora.

## Fase 7 · Noche: se duerme solo y se levanta de malas · M

- Entre las 22:00 y las 8:00, si está dormido **no se despierta solo** al llenar la energía: duerme hasta las
  8:00.
- **A la 1:00**, si sigue despierto, se duerme solo en el suelo y queda marcado que nadie lo acostó.
- **A las 8:00 se despierta:**
  - si lo acostaron → "¡Buenos días! Dormí genial ☀️";
  - si se durmió solo → **de malas**:
    - mood nuevo `grumpy` y −15 de felicidad;
    - se queja en el bocadillo: "¡Nadie me acostó! Dormí fatal 😾";
    - notificación: "Pocky se levantó de malas";
    - se le pasa con un mimo, o solo a las 3 h.
- **Si lo despiertan de noche con el botón** → también de malas: "¡Me despertaron! 😾"

## Fase 8 · Cacas · M

- Cada comida o golosina programa una caca 2 h después, con un máximo de 3 en la isla.
- Salen en los claros (como las golosinas) y la posición sale de los datos, así que los dos ven lo mismo.
- Cada caca visible hace bajar la limpieza más rápido.
- **Se limpia tocándola:** acción `clean`, que va al historial.
- Nueva necesidad "Hay 💩 en la isla".
- Modelo: espiral de esferas marrón, con dos moscas dando vueltas.

## Fase 9 · Accesorios · M/L

- Se desbloquean por cuidados totales (`totalCaresGiven`), sin moneda:

  | Cuidados | Accesorio |
  |---|---|
  | 10 | moño |
  | 25 | collar con cascabel |
  | 50 | gorro de lana |
  | 80 | lentes |
  | 120 | bufanda |
  | 180 | sombrero de paja |
  | 250 | flor |
  | 365 | corona |

- **Botón "Armario"** con un panel: lo desbloqueado se puede poner, lo bloqueado dice "faltan N cuidados".
  Huecos: cabeza / cuello / cara.
- `outfit` se sincroniza, así que los dos ven a Pocky igual. Al desbloquear algo, el bocadillo dice
  "¡Nuevo accesorio! 🎁".

## Fase 10 · Minijuego: lanzar la pelota · L

- Mientras está jugando, tocar el césped lanza una pelota allí, en parábola como la golosina. Pocky corre por
  los caminos, la trae y se sienta a esperar.
- Cada pelota traída suma +3 de felicidad, hasta +20 por partida.
- **Toque contra arrastre:** un toque corto lanza; arrastrar sigue girando la cámara.
- La pelota solo la ve quien la lanza. El otro móvil ve a Pocky jugando.

---

## Orden y entregas

0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Primero lo pequeño y lo que sirve de base para lo demás. Cada
fase es un commit.

Después de cada despliegue hay que cerrar y volver a abrir Pocky en los dos iPhones.

## Lo que no se puede probar desde aquí

- Cómo se ve y se siente en los iPhones: notificaciones reales, rendimiento y gestos.
- Lo que dependa de la hora real (noche, racha, 20:00): se prueba con `assert` y horas simuladas, no
  esperando.
