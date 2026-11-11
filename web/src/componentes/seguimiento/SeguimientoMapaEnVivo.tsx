import React, { useEffect, useState, useCallback } from "react";
import { clienteTiempoReal, EstadoConexionWs } from "../../nucleo/ws";
import { clienteApi } from "../../nucleo/api";

export interface UbicacionChofer {
  latitud: number;
  longitud: number;
  actualizado_en: string;
}

export interface DetalleViajeSeguimiento {
  id_viaje: string;
  pasajero_id?: string;
  chofer_id?: string | null;
  estado: string;
  origen: { latitud: number; longitud: number; direccion?: string };
  destino: { latitud: number; longitud: number; direccion?: string };
  precio_estimado?: string;
  precio_final?: string | null;
  moneda?: string;
}

interface Props {
  idViaje: string;
  viajeInicial?: DetalleViajeSeguimiento;
  onCambioEstado?: (nuevoEstado: string) => void;
  className?: string;
}

const ETAPAS_VIAJE = [
  { clave: "solicitado", etiqueta: "Solicitado", icono: "📝" },
  { clave: "asignado", etiqueta: "Asignado", icono: "🚕" },
  { clave: "chofer_en_camino", etiqueta: "Chofer en camino", icono: "📍" },
  { clave: "en_curso", etiqueta: "En curso", icono: "🚀" },
  { clave: "finalizado", etiqueta: "Finalizado", icono: "🏁" },
];

export const SeguimientoMapaEnVivo: React.FC<Props> = ({
  idViaje,
  viajeInicial,
  onCambioEstado,
  className = "",
}) => {
  const [viaje, setViaje] = useState<DetalleViajeSeguimiento | undefined>(viajeInicial);
  const [ubicacionChofer, setUbicacionChofer] = useState<UbicacionChofer | null>(null);
  const [estadoWs, setEstadoWs] = useState<EstadoConexionWs>(clienteTiempoReal.obtenerEstado());
  const [recuperandoEstado, setRecuperandoEstado] = useState<boolean>(false);
  const [ultimoAviso, setUltimoAviso] = useState<string | null>(null);

  // Consulta canónica HTTP de recuperación (GET /viajes/:id) tras reconexión o montaje
  const sincronizarEstadoCanonico = useCallback(async () => {
    if (!idViaje) return;
    setRecuperandoEstado(true);
    try {
      const datos = await clienteApi.get<DetalleViajeSeguimiento>(`/viajes/${encodeURIComponent(idViaje)}`);
      setViaje(datos);
      if (onCambioEstado && datos.estado) {
        onCambioEstado(datos.estado);
      }
      setUltimoAviso(`Estado canónico sincronizado con el servidor a las ${new Date().toLocaleTimeString()}.`);
    } catch {
      // Si la API falla, conservamos el estado local previo
    } finally {
      setRecuperandoEstado(false);
    }
  }, [idViaje, onCambioEstado]);

  useEffect(() => {
    if (!viajeInicial) {
      void sincronizarEstadoCanonico();
    }
  }, [idViaje, viajeInicial, sincronizarEstadoCanonico]);

  useEffect(() => {
    // 1. Suscripción al estado de red del WebSocket y recuperación canónica
    let estadoAnterior = clienteTiempoReal.obtenerEstado();
    const desuscribirEstado = clienteTiempoReal.alCambiarEstado((nuevoEstado) => {
      setEstadoWs(nuevoEstado);
      if (nuevoEstado === "CONECTADO" && estadoAnterior !== "CONECTADO") {
        void sincronizarEstadoCanonico();
      }
      estadoAnterior = nuevoEstado;
    });

    // 2. Resiliencia: si el WebSocket se reconecta tras una caída, sincronizar con GET canónico
    const desuscribirReconexion = clienteTiempoReal.alReconectar(() => {
      void sincronizarEstadoCanonico();
    });

    // 3. Suscripción a eventos de tiempo real (Tema 20)
    const procesarUbicacion = (eventoRaw: unknown) => {
      const payload = eventoRaw as { datos?: UbicacionChofer };
      if (payload.datos?.latitud && payload.datos?.longitud) {
        setUbicacionChofer({
          latitud: payload.datos.latitud,
          longitud: payload.datos.longitud,
          actualizado_en: payload.datos.actualizado_en || new Date().toISOString(),
        });
      }
    };
    const desuscribirUbicacion1 = clienteTiempoReal.on("UBICACION_CHOFER_ACTUALIZADA", procesarUbicacion);
    const desuscribirUbicacion2 = clienteTiempoReal.on("UBICACION_CHOFER", procesarUbicacion);

    const procesarEstadoViaje = (eventoRaw: unknown) => {
      const payload = eventoRaw as { datos?: { id_viaje?: string; idViaje?: string; estado?: string } };
      const idNotificado = payload.datos?.id_viaje ?? payload.datos?.idViaje;
      if (idNotificado === idViaje && payload.datos?.estado) {
        const nuevo = payload.datos.estado.toLowerCase();
        setViaje((prev) => (prev ? { ...prev, estado: nuevo } : prev));
        onCambioEstado?.(nuevo);
        setUltimoAviso(`Estado actualizado en vivo por WebSocket: ${nuevo.toUpperCase()}`);
      }
    };
    const desuscribirEstadoViaje1 = clienteTiempoReal.on("ESTADO_VIAJE_ACTUALIZADO", procesarEstadoViaje);
    const desuscribirEstadoViaje2 = clienteTiempoReal.on("VIAJE_ACTUALIZADO", procesarEstadoViaje);

    return () => {
      desuscribirEstado();
      desuscribirReconexion();
      desuscribirUbicacion1();
      desuscribirUbicacion2();
      desuscribirEstadoViaje1();
      desuscribirEstadoViaje2();
    };
  }, [idViaje, sincronizarEstadoCanonico, onCambioEstado]);

  const estadoActual = (viaje?.estado ?? "solicitado").toLowerCase();
  const indiceEtapaActual = ETAPAS_VIAJE.findIndex((e) => e.clave === estadoActual);

  return (
    <div
      data-testid="panel-seguimiento-tiempo-real"
      className={`bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4 ${className}`}
    >
      {/* Encabezado con estado y badge WebSocket */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
            Seguimiento en Vivo (Tema 20)
          </span>
          <h3 className="text-base font-extrabold text-slate-900 mt-0.5">
            Viaje #{idViaje.slice(0, 8)}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Indicador de estado WebSocket en vivo */}
          <span
            data-testid="indicador-ws-seguimiento"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
              estadoWs === "CONECTADO"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : estadoWs === "CONECTANDO"
                ? "bg-amber-50 text-amber-700 border border-amber-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                estadoWs === "CONECTADO" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              }`}
            />
            {estadoWs === "CONECTADO" ? "Tiempo Real Activo" : "Reconectando..."}
          </span>

          <button
            type="button"
            data-testid="boton-sincronizar-canonico"
            onClick={sincronizarEstadoCanonico}
            disabled={recuperandoEstado}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold cursor-pointer transition disabled:opacity-50"
            title="Consulta canónica HTTP (GET /viajes/:id) para asegurar consistencia"
          >
            🔄 {recuperandoEstado ? "..." : "Sincronizar"}
          </button>
        </div>
      </div>

      {/* Stepper de Progreso del Viaje */}
      <div className="space-y-2">
        <span className="text-xs font-bold text-slate-700">Etapa actual:</span>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {ETAPAS_VIAJE.map((etapa, idx) => {
            const completada = idx <= indiceEtapaActual;
            const esActual = idx === indiceEtapaActual;

            return (
              <div
                key={etapa.clave}
                data-testid={`etapa-${etapa.clave}`}
                className={`p-2 rounded-xl border text-center transition flex flex-col items-center justify-center gap-1 ${
                  esActual
                    ? "bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200 text-indigo-900 font-extrabold"
                    : completada
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800 font-medium"
                    : "bg-slate-50 border-slate-200 text-slate-400 font-normal"
                }`}
              >
                <span className="text-sm">{etapa.icono}</span>
                <span className="text-[11px] leading-tight">{etapa.etiqueta}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ubicación del Chofer en Tiempo Real */}
      <div
        data-testid="caja-ubicacion-chofer-tiempo-real"
        className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs"
      >
        <div className="flex items-center justify-between">
          <span className="font-bold text-slate-800 flex items-center gap-1.5">
            <span>📡</span> Posición del Chofer (difusión por WebSocket)
          </span>
          {ubicacionChofer && (
            <span className="text-[10px] text-slate-500 font-mono">
              Actualizado: {new Date(ubicacionChofer.actualizado_en).toLocaleTimeString()}
            </span>
          )}
        </div>

        {ubicacionChofer ? (
          <div className="grid grid-cols-2 gap-2 font-mono text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200">
            <div>
              <span className="text-slate-400 text-[10px] block">Latitud:</span>
              <strong data-testid="latitud-chofer-ws">{ubicacionChofer.latitud.toFixed(4)}</strong>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] block">Longitud:</span>
              <strong data-testid="longitud-chofer-ws">{ubicacionChofer.longitud.toFixed(4)}</strong>
            </div>
          </div>
        ) : (
          <p className="text-slate-500 text-[11px]">
            Esperando la primera emisión de coordenadas del chofer en camino...
          </p>
        )}
      </div>

      {/* Aviso informativo de auditoría / eventos */}
      {ultimoAviso && (
        <p
          data-testid="aviso-sincronizacion-ws"
          className="text-[11px] text-slate-500 italic bg-blue-50/50 p-2 rounded-lg border border-blue-100"
        >
          ℹ️ {ultimoAviso}
        </p>
      )}
    </div>
  );
};
