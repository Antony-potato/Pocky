'use client';
import { useEffect } from 'react';

interface Props {
  toast: { id: number; text: string } | null;
  onDismiss: () => void;
  durationMs?: number;
}

/** Reemplaza a los `alert()`, que bloqueaban el hilo y rompían la sensación de app nativa. */
export default function Toast({ toast, onDismiss, durationMs = 3000 }: Props) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [toast, onDismiss, durationMs]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      key={toast.id}
      className="absolute top-16 left-1/2 -translate-x-1/2 z-50
                 bg-gray-900/85 text-white backdrop-blur-md
                 rounded-full px-5 py-2 shadow-lg
                 font-outfit font-semibold text-sm whitespace-nowrap
                 animate-toast-in"
    >
      {toast.text}
    </div>
  );
}
