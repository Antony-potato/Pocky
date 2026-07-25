'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  getNotificationState, requestPushPermission, ensurePushSubscription,
  registerServiceWorker, NotificationState,
} from '@/lib/messaging';
import { savePushSubscription } from '@/lib/pushRegistration';
import { usePetStore } from '@/store/petStore';

const MSG: Partial<Record<NotificationState, string>> = {
  'unsupported':   'Este navegador no admite avisos',
  'needs-install': 'Añade Pocky a tu pantalla de inicio para recibir avisos',
  'denied':        'Los avisos están bloqueados: actívalos en los ajustes del navegador',
};

// El permiso de notificaciones es estado del navegador, no de React: se lee con
// useSyncExternalStore en vez de copiarlo a un useState desde un efecto.
const listeners = new Set<() => void>();

function notifyPermissionChanged() {
  listeners.forEach(l => l());
}

function subscribeToPermission(cb: () => void) {
  listeners.add(cb);

  // Si el usuario cambia el permiso desde los ajustes del navegador.
  let status: PermissionStatus | null = null;
  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    navigator.permissions
      .query({ name: 'notifications' as PermissionName })
      .then((s) => { status = s; s.addEventListener('change', cb); })
      .catch(() => undefined);
  }

  return () => {
    listeners.delete(cb);
    status?.removeEventListener('change', cb);
  };
}

export function usePush() {
  const state = useSyncExternalStore<NotificationState>(
    subscribeToPermission,
    getNotificationState,
    () => 'default',
  );

  useEffect(() => {
    // El service worker se registra siempre: da el shell offline de la PWA,
    // independientemente de si el usuario quiere notificaciones.
    void registerServiceWorker();

    // Si el permiso ya estaba concedido, rehacemos la suscripción en silencio
    // (sin diálogo, no hace falta gesto). Es necesario tras el cambio de
    // service worker: las suscripciones del anterior dejan de ser válidas.
    void ensurePushSubscription()
      .then((sub) => (sub ? savePushSubscription(sub) : undefined))
      .catch(() => undefined);
  }, []);

  /** Debe invocarse desde un gesto del usuario (el botón 🔔). */
  const enable = useCallback(async () => {
    const { showToast } = usePetStore.getState();
    const current = getNotificationState();

    if (current !== 'default' && current !== 'granted') {
      showToast(MSG[current] ?? 'No se pudieron activar los avisos');
      return;
    }

    const sub = await requestPushPermission();
    notifyPermissionChanged();

    if (!sub) {
      showToast('No se pudieron activar los avisos');
      return;
    }
    try {
      await savePushSubscription(sub);
      showToast('¡Avisos activados! 🔔');
    } catch {
      showToast('No se pudo guardar el registro');
    }
  }, []);

  return { state, enable };
}
