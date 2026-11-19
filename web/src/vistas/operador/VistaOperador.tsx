import React from "react";
import { obtenerSesion } from "../../nucleo/sesion";
import { Boton, IconoSoporte, Tarjeta } from "../../componentes/comunes";

/**
 * Vista de Operador / Soporte — Asignada a Fabio (Flujo C: WEB-008)
 */
export const VistaOperador: React.FC = () => {
  const sesion = obtenerSesion();

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 sm:p-6 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Supervisión de Viajes en Tiempo Real
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Monitoreo de estado de flota, viajes en curso y auditoría de precio dinámico congelado.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 w-fit text-xs font-semibold px-3 py-1 rounded-full bg-purple-50 text-purple-800 border border-purple-200">
          <IconoSoporte size={14} />
          Operador: {sesion?.nombre}
        </span>
      </div>

      <Tarjeta
        titulo="Viajes Activos e Historial"
        accion={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <label htmlFor="filtro-viajes-operador" className="sr-only">
              Filtrar por ID de viaje o pasajero
            </label>
            <input
              id="filtro-viajes-operador"
              type="text"
              placeholder="Filtrar por ID de viaje o pasajero..."
              className="min-h-[36px] px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white"
            />
            <Boton variante="primario" tamano="sm">
              Actualizar
            </Boton>
          </div>
        }
      >
        <div className="p-8 rounded-lg bg-slate-50 border border-dashed border-slate-300 text-center text-xs text-slate-600">
          Tabla de supervisión (a completar en WEB-008 consumiendo API-002: GET /viajes y GET /viajes/:id/auditoria-tarifa).
        </div>
      </Tarjeta>
    </div>
  );
};
