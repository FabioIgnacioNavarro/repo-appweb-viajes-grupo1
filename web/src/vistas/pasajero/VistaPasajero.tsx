import React from "react";
import { obtenerSesion } from "../../nucleo/sesion";

/**
 * Vista de Pasajero — Asignada a Joel (Flujo A: WEB-004 y WEB-005)
 *
 * Alcance técnico:
 * - Estimación de viaje con Variante Obligatoria A visible (multiplicador, demanda, lluvia).
 * - Cuenta regresiva de 3 minutos de vigencia de estimación.
 * - Confirmación atómica e idempotente con Clave-Idempotencia y precio congelado.
 * - Seguimiento de viaje en tiempo real y cancelación según estado.
 * - Cobro único final y visualización de recibo (WEB-005).
 */
export const VistaPasajero: React.FC = () => {
  const sesion = obtenerSesion();

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Panel de Pasajero</span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-0.5">
            Hola, {sesion?.nombre || "Pasajero"} 👋
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Ingresá origen y destino para calcular la tarifa dinámica con rutas reales por calles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            ID: {sesion?.idUsuario}
          </span>
        </div>
      </div>

      {/* Grid Principal de Trabajo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Izquierda: Formulario de Estimación y Variante A */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
              <span>📍</span> 1. Solicitar Estimación
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Origen</label>
                <input
                  type="text"
                  placeholder="Ej: Plaza 25 de Mayo, Resistencia"
                  defaultValue="Plaza 25 de Mayo, Resistencia"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Destino</label>
                <input
                  type="text"
                  placeholder="Ej: Av. Sarmiento y Ruta 16"
                  defaultValue="Av. Sarmiento y Ruta 16, Resistencia"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                />
              </div>
              <button
                type="button"
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
              >
                Calcular Tarifa Dinámica
              </button>
            </div>
          </div>

          {/* Desglose Variante A (Auditoría de Demanda y Lluvia) */}
          <div className="bg-amber-50/50 p-5 rounded-2xl border border-amber-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wide flex items-center gap-1.5">
                <span>⚡</span> Variante A: Precio Dinámico
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200">
                Auditable
              </span>
            </div>
            <p className="text-xs text-amber-800/80 leading-relaxed">
              El multiplicador se calcula antes de confirmar y queda congelado para este viaje.
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-white border border-amber-200">
                <span className="text-slate-500 block text-[10px]">Multiplicador</span>
                <span className="font-bold text-slate-900 text-sm">x1.25</span>
              </div>
              <div className="p-2.5 rounded-lg bg-white border border-amber-200">
                <span className="text-slate-500 block text-[10px]">Clima / Lluvia</span>
                <span className="font-bold text-slate-900 text-sm">Lluvia moderada</span>
              </div>
            </div>
          </div>
        </div>

        {/* Columna Central/Derecha: Estado del Viaje y Mapa */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <span>🗺️</span> 2. Recorrido y Estado del Viaje
              </h2>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                Sin viaje activo
              </span>
            </div>

            {/* Placeholder de Mapa Leaflet/OSM */}
            <div className="h-64 sm:h-80 rounded-xl bg-slate-100 border border-dashed border-slate-300 flex flex-col items-center justify-center p-4 text-center">
              <span className="text-3xl mb-2">🗺️</span>
              <p className="text-xs font-semibold text-slate-700">Contenedor de Mapa y Ruta (Leaflet / OSRM)</p>
              <p className="text-[11px] text-slate-500 max-w-sm mt-1">
                Aquí se renderiza el trazado de la ruta, posición del chofer en camino vía WebSocket y pines de origen/destino.
              </p>
            </div>

            {/* Controles de Acción */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <div className="text-xs text-slate-500">
                <span>Vigencia de la estimación: </span>
                <span className="font-mono font-bold text-indigo-600">02:54 min</span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  className="flex-1 sm:flex-none px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="flex-1 sm:flex-none px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
                >
                  Confirmar Viaje (Congelar Precio)
                </button>
              </div>
            </div>
          </div>

          {/* Sección de Pagos y Recibo (WEB-005) */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">💳 Estado de Pago</h3>
              <p className="text-xs text-slate-500 mt-0.5">El cobro se procesa de forma única al finalizar el viaje.</p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
              No requerido aún
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
