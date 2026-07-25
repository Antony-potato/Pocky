'use client';
import { useEffect } from 'react';
import { usePetStore, tickClock } from '@/store/petStore';
import { ensureAuth } from '@/lib/auth';

/**
 * Cada cuánto avanza el reloj. Es barato: solo actualiza un número y
 * dispara una re-proyección; no hay escrituras ni mutación de stats.
 */
const CLOCK_INTERVAL_MS = 10_000;

/**
 * Conecta el listener de Firestore y mantiene el reloj al día.
 *
 * El refresco por `visibilitychange`/`focus`/`pageshow` es imprescindible en
 * iOS: el sistema congela el JavaScript de la PWA en segundo plano, así que al
 * volver la pantalla mostraría valores caducados hasta el siguiente intervalo.
 */
export function usePetSync() {
  useEffect(() => {
    // Las reglas de Firestore exigen sesión: sin esperar a la autenticación, el
    // primer onSnapshot fallaría con permission-denied.
    let unsub: (() => void) | null = null;
    let cancelled = false;

    ensureAuth()
      .then(() => { if (!cancelled) unsub = usePetStore.getState().startListening(); })
      .catch((e) => {
        const msg = (e as { code?: string }).code === 'auth/operation-not-allowed'
          ? 'Activa el acceso anónimo en Firebase Authentication'
          : 'No se pudo conectar con Pocky';
        usePetStore.getState().showToast(msg);
      });

    const interval = setInterval(tickClock, CLOCK_INTERVAL_MS);

    const refresh = () => {
      if (document.visibilityState === 'visible') tickClock();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);

    return () => {
      cancelled = true;
      unsub?.();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, []);
}
