import React, { useState } from "react";
import { IconoOjo, IconoOjoTachado } from "./Iconos";

export interface CampoTextoProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  etiqueta: string;
  ayuda?: string;
  error?: string;
}

export const CampoTexto: React.FC<CampoTextoProps> = ({
  id,
  etiqueta,
  ayuda,
  error,
  type,
  className = "",
  ...props
}) => {
  const [mostrarSecreto, setMostrarSecreto] = useState(false);
  const esContrasena = type === "password";
  const tipoEfectivo = esContrasena ? (mostrarSecreto ? "text" : "password") : type;

  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;
  const describedBy = [idError, idAyuda].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-[#2C2B28] dark:text-slate-200">
        {etiqueta}
      </label>
      <div className="relative">
        <input
          id={id}
          type={tipoEfectivo}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`w-full min-h-[44px] rounded-lg border px-3 py-2 text-xs sm:text-sm transition bg-[#F7F5F0] dark:bg-slate-900 text-[#2C2B28] dark:text-slate-100 placeholder:text-[#7A776F] dark:placeholder:text-slate-500 focus:bg-[#FCFBF8] dark:focus:bg-slate-950 focus:outline-none focus:ring-2 ${
            esContrasena ? "pr-11" : ""
          } ${
            error
              ? "border-red-400 focus:border-red-600 focus:ring-red-200 dark:border-red-600 dark:focus:border-red-400 dark:focus:ring-red-950"
              : "border-[#D4CFC2] dark:border-slate-700 focus:border-[#4A7C59] dark:focus:border-emerald-400 focus:ring-[#4A7C59]/20 dark:focus:ring-emerald-950"
          } ${className}`}
          {...props}
        />
        {esContrasena && (
          <button
            type="button"
            onClick={() => setMostrarSecreto((prev) => !prev)}
            aria-label={mostrarSecreto ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={mostrarSecreto}
            data-testid={`${id}-alternar-visibilidad`}
            className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-[#5E5B54] dark:text-slate-400 hover:text-[#2C2B28] dark:hover:text-slate-100 cursor-pointer rounded-r-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7C59]"
            title={mostrarSecreto ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {mostrarSecreto ? <IconoOjoTachado size={18} aria-hidden="true" /> : <IconoOjo size={18} aria-hidden="true" />}
          </button>
        )}
      </div>
      {error && (
        <p id={idError} role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {ayuda && !error && (
        <p id={idAyuda} className="text-[11px] text-[#5E5B54] dark:text-slate-400">
          {ayuda}
        </p>
      )}
    </div>
  );
};

export interface OpcionSelect {
  valor: string;
  etiqueta: string;
}

export interface CampoSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  etiqueta: string;
  opciones: OpcionSelect[];
  ayuda?: string;
  error?: string;
}

export const CampoSelect: React.FC<CampoSelectProps> = ({
  id,
  etiqueta,
  opciones,
  ayuda,
  error,
  className = "",
  ...props
}) => {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;
  const describedBy = [idError, idAyuda].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-[#2C2B28] dark:text-slate-200">
        {etiqueta}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full min-h-[44px] rounded-lg border px-3 py-2 text-xs sm:text-sm transition bg-[#F7F5F0] dark:bg-slate-900 text-[#2C2B28] dark:text-slate-100 focus:bg-[#FCFBF8] dark:focus:bg-slate-950 focus:outline-none focus:ring-2 ${
          error
            ? "border-red-400 focus:border-red-600 focus:ring-red-200 dark:border-red-600 dark:focus:border-red-400 dark:focus:ring-red-950"
            : "border-[#D4CFC2] dark:border-slate-700 focus:border-[#4A7C59] dark:focus:border-emerald-400 focus:ring-[#4A7C59]/20 dark:focus:ring-emerald-950"
        } ${className}`}
        {...props}
      >
        {opciones.map((op) => (
          <option key={op.valor} value={op.valor} className="bg-[#F7F5F0] dark:bg-slate-900 text-[#2C2B28] dark:text-slate-100">
            {op.etiqueta}
          </option>
        ))}
      </select>
      {error && (
        <p id={idError} role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {ayuda && !error && (
        <p id={idAyuda} className="text-[11px] text-[#5E5B54] dark:text-slate-400">
          {ayuda}
        </p>
      )}
    </div>
  );
};
