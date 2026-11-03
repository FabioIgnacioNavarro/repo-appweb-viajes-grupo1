import React, { useState } from "react";
import { obtenerSesion } from "../../nucleo/sesion";

/**
 * Vista de Chofer — Asignada a Valentino (Flujo B: WEB-006 y WEB-007)
 *
 * Alcance técnico:
 * - Toggle de disponibilidad conectado a ms-flota (PUT /choferes/yo/disponibilidad).
 * - Envío y simulación de ubicación periódica en Resistencia.
 * - Recepción de ofertas en tiempo real vía WebSocket (Tema 20) con cuenta regresiva de 60s.
 * - Aceptación concurrente de oferta (resolución de carreras e invariante: 1 solo viaje activo por chofer).
 * - Avance de estados del viaje (En camino -> En curso -> Finalizado).
 */
export const VistaChofer: React.FC = () => {
  const sesion = obtenerSesion();
  const [disponible, setDisponible] = useState(false);

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Panel de Chofer</span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-0.5">
            Hola, {sesion?.nombre || "Chofer"} 🚕
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Gestioná tu estado de disponibilidad y recibí ofertas de viaje cercanas en tiempo real.
          </p>
        </div>

        {/* Toggle de Disponibilidad */}
        <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
          <span className="text-xs font-semibold text-slate-700">Disponibilidad:</span>
          <button
            type="button"
            onClick={() => setDisponible(!disponible)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer ${
              disponible
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-slate-200 text-slate-600 hover:bg-slate-300"
            }`}
          >
            {disponible ? "Disponible (Activo)" : "No disponible"}
          </button>
        </div>
      </div>

      {/* Grid de Trabajo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bandeja de Ofertas en Tiempo Real */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <span>🔔</span> Ofertas Recibidas
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                WebSocket
              </span>
            </div>

            {/* Lista o Estado Vacío */}
            {!disponible ? (
              <div className="p-6 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
                Activá tu disponibilidad para comenzar a recibir ofertas de pasajeros cercanos.
              </div>
            ) : (
              <div className="space-y-3">
                {/* Tarjeta de Oferta Ejemplo */}
                <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-900">Oferta #OF-8492</span>
                    <span className="text-xs font-mono font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                      ⏱ 48s
                    </span>
                  </div>
                  <div className="text-xs space-y-1 text-slate-700">
                    <div><span className="font-semibold text-slate-500">Origen:</span> Plaza 25 de Mayo</div>
                    <div><span className="font-semibold text-slate-500">Destino:</span> UNNE Campus Resistencia</div>
                    <div className="pt-1 text-sm font-extrabold text-slate-900">Importe: $ 4.250 ARS</div>
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer">
                      Aceptar
                    </button>
                    <button className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-600 text-xs font-bold transition cursor-pointer">
                      Rechazar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Viaje en Curso y Controles de Estado */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <span>🚕</span> Viaje Asignado
              </h2>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                Esperando aceptación
              </span>
            </div>

            <div className="h-64 rounded-xl bg-slate-100 border border-dashed border-slate-300 flex flex-col items-center justify-center p-4 text-center">
              <span className="text-3xl mb-2">📍</span>
              <p className="text-xs font-semibold text-slate-700">Simulador de Trayecto y GPS</p>
              <p className="text-[11px] text-slate-500 max-w-sm mt-1">
                Transmite la posición geográfica del chofer cada 2 segundos a ms-flota para actualizar la cercanía del pasajero.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                disabled
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-400 text-xs font-bold border border-slate-200 cursor-not-allowed"
              >
                1. Chofer en Camino
              </button>
              <button
                disabled
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-400 text-xs font-bold border border-slate-200 cursor-not-allowed"
              >
                2. Iniciar Viaje
              </button>
              <button
                disabled
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-400 text-xs font-bold border border-slate-200 cursor-not-allowed"
              >
                3. Finalizar y Cobrar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
