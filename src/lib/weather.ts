import type { City } from '@/types/pet';

// Clima real de la ciudad del hogar. Open-Meteo: gratis, sin clave, con CORS (se llama desde el móvil).
export type Weather = { temp: number; code: number; isDay: boolean };
export type WeatherKind = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

/** Código WMO de Open-Meteo → lo que se pinta (icono del HUD, lluvia/nieve y luz de la isla). */
export function weatherKind(code: number): WeatherKind {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain'; // llovizna, lluvia, chubascos
  if (code >= 45) return 'fog';
  return code >= 2 ? 'cloudy' : 'clear'; // 0-1 despejado, 2-3 nubes
}
export const WEATHER_LABEL: Record<WeatherKind, string> = { clear: 'Despejado', cloudy: 'Nublado', fog: 'Niebla', rain: 'Lluvia', snow: 'Nieve', storm: 'Tormenta' };

const json = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
// 2 decimales ≈ 1 km: de sobra para el clima, y en el doc compartido no queda la posición exacta de nadie.
const round = (v: number) => Math.round(v * 100) / 100;

export async function fetchWeather(c: City): Promise<Weather> {
  const { current } = await json(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code,is_day`);
  return { temp: current.temperature_2m, code: current.weather_code, isDay: current.is_day === 1 };
}

/** Ciudades que se llaman así (para elegir una en Ajustes). */
export async function searchCity(q: string): Promise<City[]> {
  const { results = [] } = await json(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=es&format=json`);
  return results.map((r: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }) =>
    ({ name: [r.name, r.admin1 ?? r.country].filter(Boolean).join(', '), lat: round(r.latitude), lon: round(r.longitude) }));
}

/** En qué ciudad está el móvil: pide la ubicación (exige HTTPS) y la convierte en nombre. */
export async function cityHere(): Promise<City> {
  const pos = await new Promise<GeolocationPosition>((ok, no) => {
    if (!navigator.geolocation) return no(new Error('sin geolocalización'));
    navigator.geolocation.getCurrentPosition(ok, no, { timeout: 15000, maximumAge: 600000 });
  });
  const lat = round(pos.coords.latitude), lon = round(pos.coords.longitude);
  // Open-Meteo no hace geocodificación inversa; BigDataCloud sí (gratis y sin clave para uso desde el navegador).
  const r = await json(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=es`).catch(() => ({}));
  return { name: [r.city || r.locality, r.principalSubdivision].filter(Boolean).join(', ') || 'Mi ubicación', lat, lon };
}
