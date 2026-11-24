import React from "react";
import { EstadoConsulta } from "./InsigniaEstadoViaje";

export interface ColumnaTabla<T> {
  clave: string;
  encabezado: string;
  renderizar: (fila: T) => React.ReactNode;
  alinearDerecha?: boolean;
  ocultarEnMovil?: boolean;
}

export interface TablaResponsivaProps<T> {
  columnas: ColumnaTabla<T>[];
  datos: T[];
  obtenerClave: (fila: T, indice: number) => string;
  cargando?: boolean;
  error?: string | null;
  mensajeCarga?: string;
  mensajeVacio?: string;
  onReintentar?: () => void;
  onClickFila?: (fila: T) => void;
  descripcionAccesible?: string;
}

export function TablaResponsiva<T>({
  columnas,
  datos,
  obtenerClave,
  cargando = false,
  error = null,
  mensajeCarga = "Cargando registros...",
  mensajeVacio = "No se encontraron resultados.",
  onReintentar,
  onClickFila,
  descripcionAccesible = "Tabla de datos",
}: TablaResponsivaProps<T>) {
  return (
    <EstadoConsulta
      cargando={cargando}
      error={error}
      vacio={datos.length === 0}
      mensajeCarga={mensajeCarga}
      mensajeVacio={mensajeVacio}
      onReintentar={onReintentar}
    >
      {/* Vista móvil (< 768px): Tarjetas apiladas sin desborde horizontal */}
      <div className="space-y-3 md:hidden" data-testid="tabla-movil-tarjetas">
        {datos.map((fila, idx) => {
          const clave = obtenerClave(fila, idx);
          return (
            <article
              key={clave}
              onClick={onClickFila ? () => onClickFila(fila) : undefined}
              tabIndex={onClickFila ? 0 : undefined}
              onKeyDown={
                onClickFila
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onClickFila(fila);
                      }
                    }
                  : undefined
              }
              className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2 ${
                onClickFila ? "cursor-pointer hover:border-slate-400 dark:hover:border-slate-600" : ""
              }`}
            >
              {columnas
                .filter((col) => !col.ocultarEnMovil)
                .map((col) => (
                  <div key={col.clave} className="flex items-start justify-between gap-3 text-xs">
                    <span className="font-semibold text-slate-500 dark:text-slate-400 shrink-0">{col.encabezado}</span>
                    <div className="text-right text-slate-900 dark:text-slate-100 min-w-0 break-words">{col.renderizar(fila)}</div>
                  </div>
                ))}
            </article>
          );
        })}
      </div>

      {/* Vista escritorio (>= 768px): Tabla HTML semántica */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="w-full text-left border-collapse text-xs sm:text-sm" aria-label={descripcionAccesible}>
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {columnas.map((col) => (
                <th
                  key={col.clave}
                  scope="col"
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide ${
                    col.alinearDerecha ? "text-right" : "text-left"
                  }`}
                >
                  {col.encabezado}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {datos.map((fila, idx) => {
              const clave = obtenerClave(fila, idx);
              return (
                <tr
                  key={clave}
                  onClick={onClickFila ? () => onClickFila(fila) : undefined}
                  className={onClickFila ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors" : ""}
                >
                  {columnas.map((col) => (
                    <td
                      key={col.clave}
                      className={`px-4 py-3 text-xs text-slate-800 dark:text-slate-200 ${col.alinearDerecha ? "text-right" : "text-left"}`}
                    >
                      {col.renderizar(fila)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </EstadoConsulta>
  );
}
