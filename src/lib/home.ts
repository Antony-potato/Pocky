// Hogar = una mascota compartida por varias personas. Lógica pura (la usan /api/home y `npm run check`).

/** Personas por hogar si el admin no ha puesto otro límite (global en config/app, o propio en pets/{id}.maxMembers). */
export const DEFAULT_MAX_MEMBERS = 5;
/** Hogares por persona si el admin no ha puesto otro límite (config/app.maxHomes). */
export const DEFAULT_MAX_HOMES = 5;
/** Por qué alguien que ya tiene `count` hogares no puede tener otro (null = puede). */
export const homesError = (count: number, max = DEFAULT_MAX_HOMES) =>
  count >= max ? `Ya estás en ${count} hogares (máximo ${max}). Sal de uno para entrar en otro.` : null;

/** Lo que este móvil recuerda (localStorage): mis hogares y en cuál estoy jugando. */
export const HOME_KEY = 'pocky_home';
export type HomeCache = { uid: string; admin: boolean; homes: { id: string; name: string }[]; current: string | null };
/** Cambiar de hogar: se apunta y se recarga (store y listeners limpios, sin estado del hogar anterior). */
export function switchHome(id: string) {
  const cache = JSON.parse(localStorage.getItem(HOME_KEY) ?? '{}');
  localStorage.setItem(HOME_KEY, JSON.stringify({ ...cache, current: id }));
  location.assign('/');
}

// Sin 0/O, 1/I/L: se dictan por teléfono sin confusiones. 31^6 ≈ 887 millones de códigos.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
/** `rand(n)` → entero en [0, n). En el servidor es crypto.randomInt. */
export const newCode = (rand: (n: number) => number) => Array.from({ length: CODE_LENGTH }, () => ALPHABET[rand(ALPHABET.length)]).join('');
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Por qué `uid` no puede entrar en este hogar (null = puede, o ya está dentro). */
export function joinError(pet: { members?: Record<string, unknown>; maxMembers?: number }, uid: string, globalMax = DEFAULT_MAX_MEMBERS): string | null {
  const members = pet.members ?? {}, max = pet.maxMembers ?? globalMax;
  if (uid in members) return null;
  return Object.keys(members).length >= max ? `Este hogar ya está completo (máximo ${max} personas).` : null;
}
