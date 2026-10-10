# Plan: acercar la isla a la referencia

> **Estado:** aplicado con las opciones recomendadas: repisa fina de arena, pasto corto de ~8k manojos (la
> mitad en dispositivos modestos), tejas recoloreadas a paja, sin objetos nuevos y sin cúpula real (bastó la
> corrección de sombreado). Resultado medido:
> - el borde se oscurece de forma continua (170 → 143 → 122 → 99);
> - césped `#9cb764` (referencia `#9cb754`);
> - mar `#55a3b5` (referencia `#5ba7bd`);
> - camino, rocas y piedras a pocos puntos de la referencia;
> - 456k triángulos y 169 draw calls.

Estado de partida: tercera iteración (árboles por matas, rocas facetadas, caminos en el shader de la hierba,
vegetación por densidad). Referencia: imagen diurna de la isla (`43f6d949-…jpg`).

Todo lo de abajo está **medido**: capturas de la escena con la cámara del juego y colores medios muestreados
en las mismas zonas de la referencia y de nuestra captura (script de muestreo con Chrome headless, ver §10).

---

## 1. Diagnóstico

### 1.1 El terreno parece hundido en el centro

**Causa medida.** Perfil de luminosidad bajando por el borde delantero de la isla (de la hierba al agua):

| Tramo | Referencia | Nuestra |
|---|---|---|
| Césped plano | L 178–180 | L 161–164 |
| Inicio del borde redondeado | baja poco a poco: 173 → 164 → 150 | **sube**: 165 → **169** |
| Final del borde | 128 → 101 | 154 → 95 |
| Tierra del acantilado | L 82–97, marrón apagado `#7c5b4c` | L 97–101, marrón anaranjado `#885e20` |

En la referencia el borde se **oscurece** de forma continua al redondearse: se lee como una meseta que cae.
En la nuestra, justo donde empieza el bisel hay una **franja más clara** que el césped. El sol viene de delante
a la derecha (`[7, 14, 8.5]`), así que la cara inclinada del borde, que mira al sur, recibe más luz que la parte
plana. Un borde más claro que el centro es exactamente lo que el ojo interpreta como un **reborde levantado con
el centro hundido**, como una bandeja.

En la iteración 3 se nota más por dos cosas:
- la vegetación se concentró junto a los objetos de la periferia;
- el centro quedó como césped limpio y uniforme.

Así el contraste del reborde claro destaca más.

### 1.2 La arena y el agua alrededor de la isla no se integran

Perfil de la orilla, de la tierra al agua:

| | Referencia | Nuestra |
|---|---|---|
| Tierra → contacto | `#7c5b4c` → línea fina gris-azulada `#989995` | `#865c1f` → mezcla beige `#a3906c` |
| Línea de espuma | `#8cb8c2` (L175), suave | `#9dd5d6` (**L201**), casi blanca y dura |
| Agua junto a la isla | `#62aabf` (L156) | `#56bfc8` (L169), cian saturado |
| Agua lejos | `#5ba7bd` (L152) | `#55b4c3` (L161) |

En la referencia el agua de la orilla es **casi igual** que la de lejos (+4 de luminosidad) y la espuma es solo
una línea fina de un azul pálido. En la nuestra hay un salto duro: tierra naranja, una banda beige, espuma casi
blanca y luego un anillo cian brillante. Esa banda beige es lo que se lee como "arena" pegada encima, no como
orilla.

### 1.3 Por qué no se parece más a la referencia (aparte de lo anterior)

Paleta muestreada en zonas equivalentes:

| Elemento | Referencia | Nuestra | Diferencia |
|---|---|---|---|
| Césped | `#a5c05f` / `#9cb754` | `#87b63c` / `#8bb93c` | el nuestro es más saturado y algo más oscuro |
| Copa, parte iluminada | `#bdc973` / `#c0c66a` (L190) | `#87c537` / `#74b427` (L156–174) | la referencia sube a un verde amarillo **pálido** |
| Copa, sombra | `#5f7b2c` / `#7c9a36` | `#64a21e` | la referencia tiene sombras oliva más profundas: más rango |
| Tronco | `#7d472a` | `#663b0d` | el nuestro es más oscuro y saturado |
| Tierra del camino | `#d4af79` | `#d3ab6c` | ✓ casi igual |
| Piedras del camino | `#d3b790` (beige cálido) | `#c0b39a` (gris) | |
| Rocas | `#d2bba1` | `#aca087` | las de la referencia son más claras y cálidas |
| Tejado | `#9b7b4f` (paja apagada) | `#c0893c` (naranja) | |
| Tierra del acantilado | `#7e5d4b` | `#885e20` | |

En resumen, la referencia tiene un acabado de **arcilla o pastel**:
- saturación baja y valores claros;
- un rango de luz amplio en las copas (amarillo pálido arriba, oliva abajo);
- sombras suaves y oclusión marcada en los pliegues.

La nuestra tiene la saturación de un render por defecto: verde lima, naranja y cian. Esto pesa más en el
parecido que cualquier cambio de geometría.

Otras diferencias de forma, por orden de impacto:
- **Copas:** en la referencia, cada mata tiene una textura de **bultitos pequeños** (tipo coliflor) muy marcada; las nuestras se ven lisas.
- **Caminos:** los de la referencia tienen bordes **suaves y curvos** (no mordidos) y adoquines redondos claros; en el cruce hay una explanada.
- **Casa:** el tejado de la referencia es de **paja gruesa** con el borde redondeado (el nuestro, de tejas de escama naranjas). Tiene hiedra con hojas, ventana redonda y jardineras.
- **Objetos que solo están en la referencia:** sillas, regadera, poste indicador, macetas, hamaca y rampa, farola, cubo en el muelle. Son **contenido nuevo** (ver §8).

---

## 2. Fase 1: terreno abombado, no hundido (prioridad alta, poco esfuerzo)

Objetivo: que el borde de la hierba siempre se oscurezca al caer, sea cual sea la luz, y que el centro se lea un
poco más alto.

**Cambios** en `GRASS` (`Island.tsx`):
1. **Oscurecer por pendiente, no por altura.** En el parche `light` (ya hay normal en espacio de vista) hay que
   pasar la normal al mundo y aplicar
   `outgoingLight *= mix(.6, 1., smoothstep(.55, .985, wn.y))`.
   Así cualquier superficie que empiece a caer pierde luz desde el primer centímetro y la franja clara
   desaparece. El oscurecimiento por altura que hay ahora (`mix(.7, 1., …vW.y)`) se queda solo para el tramo
   bajo.
2. **Tono de cúpula:** un degradado radial muy suave, con el centro +4 % y el borde −6 %, usando la misma
   elipse de la isla (`RX`, `RZ`).
3. **Manchas grandes del césped:** bajar el contraste de `vnoise(p * .28)` en el centro (ahora es de 0.84 a
   1.08) para que no salgan sombras grandes que parezcan una hondonada.

**Opción 1b (solo si 1 no basta):** una cúpula de verdad.
- La tapa de hierba pasa a ser una malla subdividida con altura `heightAt(x, z)` (unos 0.2 en el centro y 0 en el borde).
- Esa misma función se suma a todo lo que se coloca: `Scatter`, casa, puente, Pocky y la golosina.
- Más fiel a la referencia, pero toca la colocación y el movimiento de Pocky. **No lo recomiendo de entrada.**

**Verificación:** repetir el perfil de §1.1. La luminosidad debe **bajar de forma continua** desde el césped hasta la tierra.

**Coste:** 0 triángulos y unas pocas instrucciones más en el shader de la hierba.

---

## 3. Fase 2: orilla de arena integrada con el agua (prioridad alta)

Objetivo: tierra → arena mojada → línea de espuma suave → agua, sin saltos, con los valores de la referencia.

**Cambios:**
1. **Repisa de arena** al nivel del agua: un anillo fino (extrusión de la silueta de la isla desplazada
   0.25–0.4 hacia fuera) entre y = −1.52 y −1.42, que entra un poco en el agua. Shader:
   - arena seca `#d9c8a6` arriba;
   - arena mojada (×0.8, más fría) en los 5–8 cm junto al agua;
   - borde irregular con ruido.
   Coste: 1 malla con unos 400 triángulos.
2. **Mar** (shader `SEA`):
   - **Arena bajo el agua:** donde la distancia a la orilla es menor de ~0.6, mezclar el color del agua con el de la arena, para que parezca agua poco profunda.
   - **Espuma:** bajar de blanca (`.97, .99, 1` al 90 %) a azul pálido (`#cfe6ea` al 60 %), más fina (0.08 en vez de 0.26) y con el borde más suave. La ola que se aleja se queda, pero más tenue.
   - **Zona poco profunda:** reducir el aclarado de `uShallow` (ahora el agua de la orilla es +8 de luminosidad y más cian). La referencia apenas aclara.
3. **Acantilado** (`DIRT`): desaturar hacia `#7e5d4b` y suavizar los estratos.
4. **Rocas de la orilla:** su base mojada ahora es muy oscura (L103). Hay que subirla para que no haga de mancha negra en el contacto.

**Decisión pendiente:** ¿una playita de arena visible o solo una línea fina como en la referencia? Recomiendo la
repisa fina: se lee como arena y sigue el estilo.

**Coste:** unos +400 triángulos y una draw call.

---

## 4. Fase 3: pasto corto en toda la isla, optimizado

Objetivo: césped con textura de "pastito" corto por toda la superficie, sin afectar al rendimiento en móvil.

**Técnica elegida:** briznas instanciadas por GPU en **una sola draw call**.
- **Geometría:** cada instancia es un manojito de 3 briznas, cada brizna **un solo triángulo** (3 triángulos por manojo).
- **Atributo por instancia:** `vec4(x, z, giro, escala)`, calculado una vez en CPU. Son unos 16 bytes por manojo.
- **Vértices:** el vertex shader coloca la brizna, la escala y la mece con el viento (`sin(t + x·k)` en la punta, muy barato).
- **Normales hacia arriba**, como en los manojos actuales, para que la hierba se ilumine igual que el suelo.
- **Color:** el fragment shader usa **la misma función de color del césped** con la posición de la base de la brizna, más una punta algo más clara. Así cada brizna sale del tono exacto del suelo que tiene debajo y no se ve una alfombra pegada encima.
- **Sombras:** recibe sí, proyecta no.
- **Dónde no hay pasto:**
  - caminos y explanada (la misma textura máscara `pathMask`, sin ruido);
  - estanque, casa, huerto, losas, cama y cuencos (una segunda máscara de exclusión en el mismo canvas, canal G);
  - el borde redondeado de la isla (por altura).
- **Reparto:** rejilla con desorden (celda de ~0.13), para que no haya filas ni repetición.
- **Tamaño:** altura 0.06–0.11, ancho 0.02–0.03. Es "pastito": textura, no matas.
- **Los manojos decorativos actuales se mantienen** como acentos más altos.

**Presupuesto:**
- Superficie útil: unas 165 u² (la elipse de la isla menos caminos, estanque y casa).
- Con celda de 0.13 salen **unos 10 000 manojos = 30 000 triángulos**, una draw call y ninguno en el pase de sombras.
- Calidad automática: la mitad de densidad en dispositivos modestos (`navigator.hardwareConcurrency <= 4` o pantalla pequeña con DPR 3).

**Descartado:**
- *Shell texturing* (capas de pelo): 8 o más pasadas a pantalla completa con alpha test; el fill-rate mata en móvil.
- Tarjetas con textura y transparencia: overdraw y ordenación.
- Solo shader: barato, pero no da relieve ni rompe la silueta.

**Cambio de infraestructura:** `shaded()` (`materials.ts`) necesita un parche opcional de vertex shader.

**Verificación:**
- Capturas cerca y lejos; que no haya parpadeo (*aliasing*) con la cámara ortográfica.
- Draw calls +1 y triángulos +30k medidos con `renderer.info`.

---

## 5. Fase 4: paleta e iluminación tipo referencia (mayor impacto en el parecido)

**Paleta.** Ajustar las constantes `C`, `WOODS`, `TINTS` y `GRASS_TONES`, y los colores de los shaders, hacia
la tabla de §1.3:
- **Hierba:** `#9ccb5e` → valor final medido sobre `#a5c05f` (menos saturada, algo más clara).
- **Copas:** instancias menos saturadas, con la rampa del color por vértice ampliada (puntas `#c0c66a`, sombra `#5f7b2c`).
- **Tronco:** `#7d472a`.
- **Rocas y piedras:** beige cálido `#d2bba1` / `#d3b790`.
- **Tejado:** paja `#b08a55`–`#9b7b4f` en vez de naranja (sin cambiar el modelo).
- **Mar:** `#5ba7bd`, sin anillo cian.

**Luz** (`World.tsx` y `timeBackground.ts`):
- sol algo más cálido y con un poco menos de intensidad;
- hemisférica algo más alta (más relleno, sombras menos negras);
- sombras más suaves (`shadow-radius` mayor o `PCFSoftShadowMap`).

Sin posproceso: el SSAO cuesta demasiado en móvil. La oclusión ya va en el color por vértice y en el `OCCLUDERS` del césped.

**Verificación:** con el mismo script de muestreo (§10), que cada color quede a una distancia ΔE de menos de ~10 del de la referencia.

---

## 6. Fase 5: copas con textura de bultitos

En la referencia, cada mata tiene muchos bultitos pequeños. Para conseguirlo sin más polígonos:
- En `MAT.foliage`, perturbar la normal con un ruido celular sobre la posición local (`vL`): normal
  mapping procedural.
- Oscurecer ligeramente los "huecos" entre bultitos.
- Coste: 0 triángulos y algo de ALU solo en los píxeles de las copas.

En las matas grandes (r > 0.45), subir `lobes` de 11 a ~16 para que la silueta también festonee.

---

## 7. Fase 6: caminos y casa

1. **Caminos:**
   - bajar la amplitud y la frecuencia del ruido del borde, para curvas suaves como en la referencia;
   - adoquines redondos y claros (`FLAGS` más redondos, `#d3b790`) en los tramos de piedras, más numerosos y en grupo;
   - una explanada más ancha en el cruce (un disco más en `pathMask`).
2. **Casa** (sin cambiar el diseño):
   - recolorear las tejas a tonos de paja;
   - hileras algo más gruesas y redondeadas en el alero;
   - hiedra con hojas (manojos de hojas planas sobre el muro, como `CLOVER`) en lugar de bolas.
   - Ventana redonda en el hastial y jardineras: **opcional**, porque añade elementos.

---

## 8. Opcional (contenido nuevo)

Objetos que la referencia tiene y nosotros no:
- sillas junto al picnic;
- regadera en el huerto;
- poste indicador;
- macetas en la puerta;
- hamaca y rampa en el rincón de Pocky;
- farola;
- cubo en el muelle.

Solo si quieres ampliar la escena; hasta ahora lo hemos evitado a propósito.

---

## 9. Presupuesto de rendimiento

| | Triángulos (con sombras) | Draw calls |
|---|---|---|
| Actual (iteración 3) | 428k | 168 |
| + Fase 1 terreno | 428k | 168 |
| + Fase 2 orilla | ~429k | 169 |
| + Fase 3 pasto (calidad alta) | ~459k | 170 |
| + Fases 4–6 | ~460k | 170 |

El pasto no proyecta sombras y en calidad baja se queda en ~15k triángulos.

---

## 10. Orden recomendado y verificación

1. **Fase 1** (terreno) y **Fase 2** (orilla): corrigen lo que más molesta ahora y son rápidas.
2. **Fase 4** (paleta y luz): es lo que más acerca a la referencia.
3. **Fase 3** (pasto corto).
4. **Fases 5 y 6** (bultitos en las copas, caminos y casa).

Después de cada fase:
- capturas con las mismas cámaras (vista general, cerca de la orilla, cerca de un árbol, móvil vertical);
- el **script de muestreo** comparando colores y el perfil del borde con la referencia;
- `renderer.info` para triángulos y draw calls;
- `npm run check` y comprobar que Pocky sigue andando por sus rutas.

## 11. Lo que necesito que decidas

1. Orilla: ¿**repisa fina de arena** (recomendado) o una playita más ancha?
2. Pasto corto: ¿densidad de "alfombra" (10k manojos) o más ligera (5k)?
3. Tejado: ¿recolorear las tejas a paja (recomendado) o cambiar a un tejado de paja de verdad (otro modelo)?
4. ¿Añadimos los objetos de la referencia de §8?
5. ¿Cúpula real del terreno (1b) si la corrección de sombreado no basta?
