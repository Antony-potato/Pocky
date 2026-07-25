'use client';

const KEY = 'pocky_device_id';

/**
 * Identificador estable por dispositivo.
 * En la Fase 3 lo reemplaza el UID de Firebase Anonymous Auth.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `device_${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}
