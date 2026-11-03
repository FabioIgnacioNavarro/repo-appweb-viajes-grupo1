import React from "react";
import { obtenerSesion } from "../../nucleo/sesion";

/**
 * Vista de Operador / Soporte — Asignada a Fabio (Flujo C: WEB-008)
 */
export const VistaOperador: React.FC = () => {
  const sesion = obtenerSesion();

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-purple-600 uppercase tracking-wider">Mesa de Operaciones y Soporte</span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-0.5">
            Supervisión de Viajes en Tiempo Real
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Monitoreo de estado de flota, viajes en curso y auditoría de precio dinámico congelado.
          </p>
        </div>
        <span className="text-xs font-semibold px-3 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
          Operador: {sesion?.nombre}
        </span>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
            Viajes Activos e Historial
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filtrar por ID de viaje o pasajero..."
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50"
            />
            <button className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition">
              Actualizar
            </button>
          </div>
        </div>

        <div className="p-8 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
          Tabla de supervisión (a completar en WEB-008 consumiendo API-002: GET /viajes y GET /viajes/:id/auditoria-tarifa).
        </div>
      </div>
    </div>
  );
};
