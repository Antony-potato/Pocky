// Widget de pantalla de inicio: lo que se copia desde Ajustes. `url` es /api/widget?pet=…&k=… (lo da /api/home).
// Una PWA no puede tener widgets propios: los pinta una app de widgets (Scriptable en iPhone, KWGT en Android) que
// solo sabe enseñar la imagen que le da el servidor.

/** Script para Scriptable (iPhone): pone la imagen de fondo del widget y la vuelve a pedir pasados 15 min. */
export const scriptableCode = (url: string, app: string) => `// Pocky: widget para Scriptable (iPhone).
// 1) Pega esto en un script nuevo de Scriptable y ponle de nombre Pocky.
// 2) Pantalla de inicio: mantén pulsado > Editar > Añadir widget > Scriptable > tamaño pequeño o mediano.
// 3) Mantén pulsado el widget > Editar widget > Script: Pocky.
const WIDGET = ${JSON.stringify(url)};
const APP = ${JSON.stringify(app)};

const size = config.runsInWidget && config.widgetFamily !== "medium" ? "small" : "medium";
const fm = FileManager.local();
const cache = fm.joinPath(fm.cacheDirectory(), "pocky-" + size + ".png");
let img = null;
try {
  img = await new Request(WIDGET + "&s=" + size + "&t=" + Date.now()).loadImage();
  fm.writeImage(cache, img);
} catch (e) {
  if (fm.fileExists(cache)) img = fm.readImage(cache); // sin conexión: la última que se vio
}

const w = new ListWidget();
w.url = APP; // al tocarlo abre Pocky
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000); // iOS decide el momento exacto; antes de 15 min, no
if (img) w.backgroundImage = img;
else {
  w.backgroundColor = new Color("#151a19");
  const t = w.addText("Pocky no pudo conectarse");
  t.textColor = Color.white();
  t.font = Font.boldRoundedSystemFont(14);
}
if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
`;

/** Fórmula para el Bitmap de una imagen de KWGT (Android): el final cambia cada 15 min, así la vuelve a bajar. */
export const kwgtFormula = (url: string) => `${url}&s=medium&t=$df(H)$$mu(floor, df(m) / 15)$`;
