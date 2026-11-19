import React from "react";
import { obtenerSesion } from "../../nucleo/sesion";
import { IconoAdmin, IconoRayo, Tarjeta } from "../../componentes/comunes";

/**
 * Vista de Administrador — Asignada a Fabio (Flujo C: WEB-008)
 */
export const VistaAdmin: React.FC = () => {
  const sesion = obtenerSesion();

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 sm:p-6 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Configuración Global y Reglas de Demanda
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Gestión versionada y auditable de multiplicadores, zonas tarifarias y salud de microservicios.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 w-fit text-xs font-semibold px-3 py-1 rounded-full bg-amber-50 text-amber-900 border border-amber-200">
          <IconoAdmin size={14} />
          Admin: {sesion?.nombre}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Tarjeta
          titulo={
            <span className="inline-flex items-center gap-2">
              <IconoRayo size={16} className="text-amber-700" />
              Configuración de Variante A (Regla de Precio Dinámico)
            </span>
          }
          subtitulo="Permite editar multiplicadores mínimos, máximos y recargos por lluvia. Cada actualización genera una nueva versión auditable en PostgreSQL."
        >
          <div className="p-6 rounded-lg bg-slate-50 border border-dashed border-slate-300 text-center text-xs text-slate-600">
            Formulario de edición de regla versionada (a conectar en WEB-008 con PUT /reglas/demanda).
          </div>
        </Tarjeta>

        <Tarjeta titulo="Estado de Salud de Microservicios">
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
              <span className="font-semibold text-slate-800">ms-viajes (:3000)</span>
              <span className="text-emerald-800 font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                200 OK / Ready
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
              <span className="font-semibold text-slate-800">ms-tarifas (:3001)</span>
              <span className="text-emerald-800 font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                200 OK / Ready
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
              <span className="font-semibold text-slate-800">ms-flota (:3002)</span>
              <span className="text-emerald-800 font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                200 OK / Ready
              </span>
            </div>
          </div>
        </Tarjeta>
      </div>
    </div>
  );
};
