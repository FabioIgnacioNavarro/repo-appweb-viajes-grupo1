import React from "react";

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
  className = "",
  ...props
}) => {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;
  const describedBy = [idError, idAyuda].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-800">
        {etiqueta}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full min-h-[44px] rounded-lg border px-3 py-2 text-xs sm:text-sm transition bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 ${
          error
            ? "border-red-400 focus:border-red-600 focus:ring-red-200"
            : "border-slate-300 focus:border-slate-900 focus:ring-slate-200"
        } ${className}`}
        {...props}
      />
      {error && (
        <p id={idError} role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
      {ayuda && !error && (
        <p id={idAyuda} className="text-[11px] text-slate-500">
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
      <label htmlFor={id} className="block text-xs font-semibold text-slate-800">
        {etiqueta}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full min-h-[44px] rounded-lg border px-3 py-2 text-xs sm:text-sm transition bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 ${
          error
            ? "border-red-400 focus:border-red-600 focus:ring-red-200"
            : "border-slate-300 focus:border-slate-900 focus:ring-slate-200"
        } ${className}`}
        {...props}
      >
        {opciones.map((op) => (
          <option key={op.valor} value={op.valor}>
            {op.etiqueta}
          </option>
        ))}
      </select>
      {error && (
        <p id={idError} role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
      {ayuda && !error && (
        <p id={idAyuda} className="text-[11px] text-slate-500">
          {ayuda}
        </p>
      )}
    </div>
  );
};
