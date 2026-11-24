import React, { useEffect } from "react";

export type TipoToast = "exito" | "error" | "advertencia" | "info";

export interface ToastProps {
  mensaje: string | null;
  tipo?: TipoToast;
  duracionMs?: number;
  onCerrar: () => void;
}

const ESTILOS_TOAST: Record<TipoToast, string> = {
  exito: "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-200",
  error: "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/80 text-red-900 dark:text-red-200",
  advertencia: "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200",
  info: "border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/80 text-blue-900 dark:text-blue-200",
};

export const Toast: React.FC<ToastProps> = ({
  mensaje,
  tipo = "info",
  duracionMs = 5000,
  onCerrar,
}) => {
  useEffect(() => {
    if (!mensaje || duracionMs <= 0) return;
    const temporizador = setTimeout(onCerrar, duracionMs);
    return () => clearTimeout(temporizador);
  }, [mensaje, duracionMs, onCerrar]);

  if (!mensaje) return null;

  return (
    <div
      role={tipo === "error" ? "alert" : "status"}
      aria-live={tipo === "error" ? "assertive" : "polite"}
      className={`fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-md z-50 rounded-xl border px-4 py-3 shadow-md flex items-center justify-between gap-3 text-xs sm:text-sm font-medium ${ESTILOS_TOAST[tipo]}`}
    >
      <span>{mensaje}</span>
      <button
        type="button"
        onClick={onCerrar}
        aria-label="Cerrar notificación"
        className="shrink-0 rounded-md px-2 py-1 text-xs font-bold opacity-80 hover:opacity-100 cursor-pointer"
      >
        Cerrar
      </button>
    </div>
  );
};
