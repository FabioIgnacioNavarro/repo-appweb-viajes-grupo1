import React from "react";
import { obtenerSesion } from "../../nucleo/sesion";

/**
 * Vista de Administrador — Asignada a Fabio (Flujo C: WEB-008)
 */
export const VistaAdmin: React.FC = () => {
  const sesion = obtenerSesion();

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">Panel de Administración</span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-0.5">
            Configuración Global y Reglas de Demanda
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Gestión versionada y auditable de multiplicadores, zonas tarifarias y salud de microservicios.
          </p>
        </div>
        <span className="text-xs font-semibold px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
          Admin: {sesion?.nombre}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Editor de Regla de Demanda */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
            ⚡ Configuración de Variante A (Regla de Precio Dinámico)
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Permite editar multiplicadores mínimos, máximos y recargos por lluvia. Cada actualización genera una nueva versión auditable en PostgreSQL.
          </p>
          <div className="p-6 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
            Formulario de edición de regla versionada (a conectar en WEB-008 con PUT /reglas/demanda).
          </div>
        </div>

        {/* Monitoreo del Cluster y Dependencias */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
            🏥 Estado de Salud de Microservicios
          </h2>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span className="font-semibold text-slate-700">ms-viajes (:3000)</span>
              <span className="text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded-md">200 OK / Ready</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span className="font-semibold text-slate-700">ms-tarifas (:3001)</span>
              <span className="text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded-md">200 OK / Ready</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span className="font-semibold text-slate-700">ms-flota (:3002)</span>
              <span className="text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded-md">200 OK / Ready</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
