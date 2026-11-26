import React from "react";
import { IconoCodigo, IconoInfo } from "../comunes";

export interface ParametrosSimulacion {
  hora?: number; // 0 a 23
  llueve?: boolean;
  choferesDisponibles?: number;
  solicitudesActivas?: number;
}

export interface FactoresVisualizacion {
  tarifaBasePesos?: string;
  factorHorario?: number;
  franjaHoraria?: string;
  factorLluvia?: number;
  llueve?: boolean;
  factorDisponibilidad?: number;
  choferesDisponibles?: number;
  factorDemanda?: number;
  solicitudesActivas?: number;
  multiplicadorDemanda?: number;
}

export interface PanelDesarrolladorProps {
  activo: boolean;
  onAlternarActivo: () => void;
  parametros: ParametrosSimulacion;
  onCambiarParametros: (params: ParametrosSimulacion) => void;
  onRestablecer: () => void;
  factores?: FactoresVisualizacion;
  recomendaciones?: string[];
}

const FRANJAS_POR_HORA: Record<number, string> = {
  0: "MADRUGADA", 1: "MADRUGADA", 2: "MADRUGADA", 3: "MADRUGADA", 4: "MADRUGADA", 5: "MADRUGADA",
  6: "MANANA", 7: "MANANA", 8: "MANANA", 9: "MANANA", 10: "MANANA", 11: "MANANA",
  12: "SIESTA", 13: "SIESTA", 14: "SIESTA", 15: "SIESTA",
  16: "TARDE", 17: "TARDE", 18: "TARDE", 19: "TARDE",
  20: "NOCHE", 21: "NOCHE", 22: "NOCHE", 23: "NOCHE",
};

export const PanelDesarrollador: React.FC<PanelDesarrolladorProps> = ({
  activo,
  onAlternarActivo,
  parametros,
  onCambiarParametros,
  onRestablecer,
  factores,
  recomendaciones = [],
}) => {
  const horaSeleccionada = parametros.hora ?? new Date().getHours();
  const franjaEstimada = FRANJAS_POR_HORA[horaSeleccionada] ?? "MANANA";
  const haySobrescrituras =
    parametros.hora !== undefined ||
    parametros.llueve !== undefined ||
    parametros.choferesDisponibles !== undefined ||
    parametros.solicitudesActivas !== undefined;

  return (
    <section
      aria-label="Panel de modo desarrollador y simulación de tarifas"
      className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 sm:p-5 shadow-xs transition-colors"
      data-testid="panel-desarrollador"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0">
            <IconoCodigo size={17} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Modo Desarrollador</h2>
              <span className="inline-flex items-center rounded-md bg-indigo-100 dark:bg-indigo-900/70 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-indigo-800 dark:text-indigo-200">
                Simulación en vivo
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Modificá hora, lluvia y demanda para simular el recálculo de tarifa.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onAlternarActivo}
          className="min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-slate-800 cursor-pointer transition"
          aria-expanded={activo}
          data-testid="toggle-panel-dev"
        >
          {activo ? "Ocultar controles" : "Mostrar controles"}
        </button>
      </div>

      {activo && (
        <div className="mt-4 space-y-4 pt-3 border-t border-indigo-200/70 dark:border-indigo-900/50">
          {/* Controles de Simulación */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {/* Hora del Día */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-1.5">
              <label htmlFor="sim-hora" className="block font-semibold text-slate-700 dark:text-slate-300">
                Hora simulada ({String(horaSeleccionada).padStart(2, "0")}:00 hs)
              </label>
              <input
                id="sim-hora"
                type="range"
                min="0"
                max="23"
                value={horaSeleccionada}
                onChange={(e) =>
                  onCambiarParametros({ ...parametros, hora: Number(e.target.value) })
                }
                className="w-full cursor-pointer accent-indigo-600"
                data-testid="sim-hora-slider"
              />
              <span className="block text-[11px] text-indigo-700 dark:text-indigo-400 font-medium">
                Franja: {franjaEstimada}
              </span>
            </div>

            {/* Condición de Lluvia */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-1.5">
              <label htmlFor="sim-lluvia" className="block font-semibold text-slate-700 dark:text-slate-300">
                Condición climática
              </label>
              <select
                id="sim-lluvia"
                value={parametros.llueve === undefined ? "real" : parametros.llueve ? "lluvia" : "seco"}
                onChange={(e) => {
                  const val = e.target.value;
                  onCambiarParametros({
                    ...parametros,
                    llueve: val === "real" ? undefined : val === "lluvia",
                  });
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                data-testid="sim-lluvia-select"
              >
                <option value="real">Tiempo real (API Clima)</option>
                <option value="seco">Seco (0.0 mm)</option>
                <option value="lluvia">Lluvia activa (5.0 mm)</option>
              </select>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Aplica recargo si hay precipitación
              </span>
            </div>

            {/* Choferes Disponibles */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-1.5">
              <label htmlFor="sim-choferes" className="block font-semibold text-slate-700 dark:text-slate-300">
                Choferes disponibles
              </label>
              <input
                id="sim-choferes"
                type="number"
                min="0"
                max="50"
                value={parametros.choferesDisponibles ?? ""}
                placeholder="Tiempo real"
                onChange={(e) => {
                  const val = e.target.value === "" ? undefined : Math.max(0, Number(e.target.value));
                  onCambiarParametros({ ...parametros, choferesDisponibles: val });
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                data-testid="sim-choferes-input"
              />
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Vacío = consultar ms-flota
              </span>
            </div>

            {/* Solicitudes Activas */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-1.5">
              <label htmlFor="sim-demandas" className="block font-semibold text-slate-700 dark:text-slate-300">
                Solicitudes activas
              </label>
              <input
                id="sim-demandas"
                type="number"
                min="0"
                max="100"
                value={parametros.solicitudesActivas ?? ""}
                placeholder="Tiempo real"
                onChange={(e) => {
                  const val = e.target.value === "" ? undefined : Math.max(0, Number(e.target.value));
                  onCambiarParametros({ ...parametros, solicitudesActivas: val });
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                data-testid="sim-demandas-input"
              />
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Vacío = consultar ms-viajes
              </span>
            </div>
          </div>

          {/* Botón Restablecer */}
          {haySobrescrituras && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onRestablecer}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition"
                data-testid="boton-restablecer-simulacion"
              >
                Restablecer a condiciones reales
              </button>
            </div>
          )}

          {/* Panel de Modificadores en Vivo */}
          {factores && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Desglose de factores de tarifa
                </h3>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Tope de regla: [0.75, 2.00]
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850 p-2 text-center">
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400 uppercase">Tarifa Base</span>
                  <strong className="mt-0.5 block text-slate-900 dark:text-slate-100">
                    ${factores.tarifaBasePesos ?? "1.000"}
                  </strong>
                </div>

                <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850 p-2 text-center">
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400 uppercase">Horario ({factores.franjaHoraria ?? franjaEstimada})</span>
                  <strong className="mt-0.5 block text-indigo-600 dark:text-indigo-400">
                    ×{(factores.factorHorario ?? 1.0).toFixed(2)}
                  </strong>
                </div>

                <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850 p-2 text-center">
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400 uppercase">Lluvia ({factores.llueve ? "Sí" : "No"})</span>
                  <strong className="mt-0.5 block text-indigo-600 dark:text-indigo-400">
                    ×{(factores.factorLluvia ?? 1.0).toFixed(2)}
                  </strong>
                </div>

                <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850 p-2 text-center">
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400 uppercase">Disponibilidad ({factores.choferesDisponibles ?? 0})</span>
                  <strong className="mt-0.5 block text-indigo-600 dark:text-indigo-400">
                    ×{(factores.factorDisponibilidad ?? 1.0).toFixed(2)}
                  </strong>
                </div>

                <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850 p-2 text-center">
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400 uppercase">Demanda ({factores.solicitudesActivas ?? 0})</span>
                  <strong className="mt-0.5 block text-indigo-600 dark:text-indigo-400">
                    ×{(factores.factorDemanda ?? 1.0).toFixed(2)}
                  </strong>
                </div>

                <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 p-2 text-center">
                  <span className="block text-[10px] text-amber-800 dark:text-amber-300 font-bold uppercase">Tope Acotado</span>
                  <strong className="mt-0.5 block text-amber-900 dark:text-amber-200 font-extrabold">
                    ×{(factores.multiplicadorDemanda ?? 1.0).toFixed(2)}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Recomendaciones al usuario */}
          {recomendaciones.length > 0 && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/80 dark:bg-emerald-950/30 p-3 space-y-1.5 text-xs" data-testid="bloque-recomendaciones">
              <div className="flex items-center gap-1.5 font-bold text-emerald-900 dark:text-emerald-200">
                <IconoInfo size={16} aria-hidden="true" />
                <span>Recomendaciones inteligentes de ahorro</span>
              </div>
              <ul className="space-y-1 pl-4 list-disc text-emerald-800 dark:text-emerald-300">
                {recomendaciones.map((rec, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
