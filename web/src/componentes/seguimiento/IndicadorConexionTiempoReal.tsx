import React, { useEffect, useState } from "react";
import { clienteTiempoReal, EstadoConexionWs } from "../../nucleo/ws";

interface Props {
  className?: string;
  mostrarControlesSimulacion?: boolean;
}

export const IndicadorConexionTiempoReal: React.FC<Props> = ({
  className = "",
  mostrarControlesSimulacion = true,
}) => {
  const [estado, setEstado] = useState<EstadoConexionWs>(clienteTiempoReal.obtenerEstado());
  const [ultimoEvento, setUltimoEvento] = useState<{ nombre: string; fecha: string } | null>(null);
  const [totalEventos, setTotalEventos] = useState<number>(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { clienteTiempoReal?: typeof clienteTiempoReal }).clienteTiempoReal = clienteTiempoReal;
    }

    const desuscribirEstado = clienteTiempoReal.alCambiarEstado((nuevoEstado) => {
      setEstado(nuevoEstado);
    });

    const desuscribirTodos = clienteTiempoReal.on("*", (eventoRaw) => {
      const e = eventoRaw as unknown as { tipo?: string; evento?: string };
      const nombre = e.tipo ?? e.evento ?? "DESCONOCIDO";
      setUltimoEvento({ nombre, fecha: new Date().toLocaleTimeString() });
      setTotalEventos((prev) => prev + 1);
    });

    return () => {
      desuscribirEstado();
      desuscribirTodos();
    };
  }, []);

  const forzarDesconexion = () => {
    clienteTiempoReal.desconectar();
  };

  const reconectar = () => {
    clienteTiempoReal.conectar();
  };

  return (
    <div
      data-testid="indicador-tiempo-real-completo"
      className={`bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-2 text-xs ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Badge del estado con punto de pulso */}
          <span
            data-testid="badge-estado-ws"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider text-[10px] ${
              estado === "CONECTADO"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : estado === "CONECTANDO"
                ? "bg-amber-50 text-amber-700 border border-amber-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                estado === "CONECTADO"
                  ? "bg-emerald-500 animate-pulse"
                  : estado === "CONECTANDO"
                  ? "bg-amber-500 animate-ping"
                  : "bg-rose-500"
              }`}
            />
            {estado === "CONECTADO"
              ? "WebSocket Activo"
              : estado === "CONECTANDO"
              ? "Reconectando con backoff..."
              : "Desconectado (HTTP Polling)"}
          </span>
          <span className="text-slate-500 text-[11px] hidden sm:inline">
            Canal bidireccional (Tema 20)
          </span>
        </div>

        {/* Métricas rápidas de eventos */}
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span>Eventos recibidos: <strong data-testid="conteo-eventos-ws" className="text-slate-800 font-mono">{totalEventos}</strong></span>
          {ultimoEvento && (
            <span className="hidden md:inline bg-slate-100 px-2 py-0.5 rounded text-[10px] font-mono text-slate-700">
              Último: {ultimoEvento.nombre} ({ultimoEvento.fecha})
            </span>
          )}
        </div>
      </div>

      {/* Controles para probar resiliencia y reconexión en defensas o E2E */}
      {mostrarControlesSimulacion && (
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
          <span>Prueba de resiliencia de red:</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="boton-simular-corte-red"
              disabled={estado !== "CONECTADO"}
              onClick={forzarDesconexion}
              className={`px-2.5 py-1 rounded font-semibold border transition ${
                estado === "CONECTADO"
                  ? "bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 cursor-pointer"
                  : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60"
              }`}
              title="Cierra el WebSocket para observar la reconexión con retroceso exponencial"
            >
              ⚡ Simular corte de red
            </button>
            <button
              type="button"
              data-testid="boton-reconectar-ws"
              disabled={estado === "CONECTADO"}
              onClick={reconectar}
              className={`px-2.5 py-1 rounded font-semibold border transition ${
                estado !== "CONECTADO"
                  ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 cursor-pointer"
                  : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60"
              }`}
            >
              🔄 Reconectar ahora
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
