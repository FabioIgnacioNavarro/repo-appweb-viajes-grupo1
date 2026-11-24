import React from "react";

const CONFIG_ESTADOS: Record<string, { etiqueta: string; clases: string }> = {
  solicitado: {
    etiqueta: "Solicitado",
    clases: "bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  },
  asignado: {
    etiqueta: "Asignado",
    clases: "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
  },
  chofer_en_camino: {
    etiqueta: "Chofer en camino",
    clases: "bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  },
  en_curso: {
    etiqueta: "En curso",
    clases: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  },
  finalizado: {
    etiqueta: "Finalizado",
    clases: "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700",
  },
  cancelado_por_pasajero: {
    etiqueta: "Cancelado (Pasajero)",
    clases: "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800",
  },
  cancelado_por_chofer: {
    etiqueta: "Cancelado (Chofer)",
    clases: "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800",
  },
  cancelado_por_operador: {
    etiqueta: "Cancelado (Operador)",
    clases: "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800",
  },
  sin_choferes_disponibles: {
    etiqueta: "Sin choferes disponibles",
    clases: "bg-orange-50 dark:bg-orange-950/40 text-orange-900 dark:text-orange-300 border-orange-200 dark:border-orange-800",
  },
};

export const InsigniaEstadoViaje: React.FC<{ estado: string; className?: string }> = ({
  estado,
  className = "",
}) => {
  const clave = estado.toLowerCase();
  const config = CONFIG_ESTADOS[clave] ?? {
    etiqueta: estado,
    clases: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${config.clases} ${className}`}
    >
      {config.etiqueta}
    </span>
  );
};

export interface EstadoConsultaProps {
  cargando?: boolean;
  error?: string | null;
  vacio?: boolean;
  mensajeCarga?: string;
  mensajeVacio?: string;
  onReintentar?: () => void;
  children?: React.ReactNode;
}

export const EstadoConsulta: React.FC<EstadoConsultaProps> = ({
  cargando = false,
  error = null,
  vacio = false,
  mensajeCarga = "Cargando información...",
  mensajeVacio = "No hay registros para mostrar.",
  onReintentar,
  children,
}) => {
  if (cargando) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-8 text-center"
      >
        <span
          aria-hidden="true"
          className="h-5 w-5 animate-spin rounded-full border-2 border-slate-400 border-t-slate-900 dark:border-t-slate-100"
        />
        <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{mensajeCarga}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-3 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-4 py-6 text-center"
      >
        <p className="text-xs sm:text-sm font-medium text-red-800 dark:text-red-300">{error}</p>
        {onReintentar && (
          <button
            type="button"
            onClick={onReintentar}
            className="min-h-[36px] rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/40 transition cursor-pointer"
          >
            Reintentar
          </button>
        )}
      </div>
    );
  }

  if (vacio) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-8 text-center">
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">{mensajeVacio}</p>
      </div>
    );
  }

  return <>{children}</>;
};
