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
  neutra: "border-[#DDD8CC] dark:border-slate-800 bg-[#EFECE4] dark:bg-slate-900 text-[#2C2B28] dark:text-slate-100",
  alerta: "border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 text-[#2C2B28] dark:text-slate-100",
  exito: "border-[#4A7C59]/30 dark:border-emerald-900/50 bg-[#E6EFE8] dark:bg-emerald-950/20 text-[#2C2B28] dark:text-slate-100",
  error: "border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 text-[#2C2B28] dark:text-slate-100",
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
            {titulo && <h2 className="text-sm sm:text-base font-semibold text-[#2C2B28] dark:text-slate-100 tracking-tight">{titulo}</h2>}
            {subtitulo && <p className="mt-0.5 text-xs text-[#5E5B54] dark:text-slate-400 leading-relaxed">{subtitulo}</p>}
          </div>
          {accion && <div className="shrink-0">{accion}</div>}
        </div>
      )}
      {children}
    </section>
  );
};
