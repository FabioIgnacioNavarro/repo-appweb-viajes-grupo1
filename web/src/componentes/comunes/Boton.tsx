import React from "react";

export type VarianteBoton = "primario" | "secundario" | "pasajero" | "chofer" | "peligro" | "fantasma";
export type TamanoBoton = "sm" | "md" | "lg";

export interface BotonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  cargando?: boolean;
  anchoCompleto?: boolean;
}

const ESTILOS_VARIANTE: Record<VarianteBoton, string> = {
  primario: "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100",
  secundario: "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-400",
  pasajero: "bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-600",
  chofer: "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600",
  peligro: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600",
  fantasma: "bg-transparent text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-400",
};

const ESTILOS_TAMANO: Record<TamanoBoton, string> = {
  sm: "min-h-[36px] px-3 py-1.5 text-xs rounded-lg",
  md: "min-h-[44px] px-4 py-2 text-xs sm:text-sm rounded-lg",
  lg: "min-h-[48px] px-5 py-2.5 text-sm rounded-xl",
};

export const Boton: React.FC<BotonProps> = ({
  variante = "primario",
  tamano = "md",
  cargando = false,
  anchoCompleto = false,
  disabled,
  className = "",
  children,
  type = "button",
  ...props
}) => {
  return (
    <button
      type={type}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.99] ${ESTILOS_VARIANTE[variante]} ${ESTILOS_TAMANO[tamano]} ${anchoCompleto ? "w-full" : ""} ${className}`}
      {...props}
    >
      {cargando && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
};
