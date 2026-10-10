/**
 * Iluminación de la escena 3D según la hora.
 * Mañana (6-12), tarde (12-18), atardecer (18-21), noche (21-6).
 * `glow` (0-1) enciende ventanas, farolillos y hoguera.
 */
export interface TimePhase {
  isNight: boolean;
  sun: string;
  sunIntensity: number;
  sky: string;
  ground: string;
  hemiIntensity: number;
  water: string;
  glow: number;
}

export function getTimePhase(hour: number): TimePhase {
  if (hour >= 6 && hour < 12)
    return { isNight: false, sun: '#fff1d6', sunIntensity: 2.2, sky: '#d6ecff', ground: '#9cc46a', hemiIntensity: 1.3, water: '#5cb6e4', glow: 0 };
  if (hour >= 12 && hour < 18)
    return { isNight: false, sun: '#ffffff', sunIntensity: 2.4, sky: '#dff1ff', ground: '#a3c86e', hemiIntensity: 1.4, water: '#56b0e2', glow: 0 };
  if (hour >= 18 && hour < 21)
    return { isNight: false, sun: '#ffb27a', sunIntensity: 1.8, sky: '#d9b3f0', ground: '#8a8f5c', hemiIntensity: 1.0, water: '#6b93d6', glow: 0.6 };
  return { isNight: true, sun: '#9db4ff', sunIntensity: 0.6, sky: '#4a4f9e', ground: '#1f2547', hemiIntensity: 0.7, water: '#1d3768', glow: 1 };
}
