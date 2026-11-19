import React from "react";

export type VarianteTarjeta = "neutra" | "alerta" | "exito" | "error";

export interface TarjetaProps {
  titulo?: React.ReactNode;
  subtitulo?: React.ReactNode;
  accion?: React.ReactNode;
  variante?: VarianteTarjeta;
  className?: string;
  children: React.ReactNode;
  "aria-labelledby"?: string;
}

const ESTILOS_TARJETA: Record<VarianteTarjeta, string> = {
  neutra: "border-slate-200 bg-white",
  alerta: "border-amber-200 bg-amber-50/50",
  exito: "border-emerald-200 bg-emerald-50/40",
  error: "border-red-200 bg-red-50/50",
};

export const Tarjeta: React.FC<TarjetaProps> = ({
  titulo,
  subtitulo,
  accion,
  variante = "neutra",
  className = "",
  children,
  "aria-labelledby": ariaLabelledBy,
}) => {
  return (
    <section
      aria-labelledby={ariaLabelledBy}
      className={`rounded-xl border p-4 sm:p-5 ${ESTILOS_TARJETA[variante]} ${className}`}
    >
      {(titulo || subtitulo || accion) && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {titulo && <h2 className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight">{titulo}</h2>}
            {subtitulo && <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">{subtitulo}</p>}
          </div>
          {accion && <div className="shrink-0">{accion}</div>}
        </div>
      )}
      {children}
    </section>
  );
};
