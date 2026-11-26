import React, { useEffect, useState } from "react";
import { clienteTiempoReal, EstadoConexionWs } from "../../nucleo/ws";
import { IconoRayo } from "../comunes";

interface Props {
  className?: string;
  mostrarControlesSimulacion?: boolean;
}

export const IndicadorConexionTiempoReal: React.FC<Props> = ({
  className = "",
  mostrarControlesSimulacion = false,
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
    clienteTiempoReal.reconectar();
  };

  return (
    <div
      data-testid="indicador-tiempo-real-completo"
      className={`bg-[#EFECE4] dark:bg-slate-900 rounded-xl border border-[#DDD8CC] dark:border-slate-800 p-3 shadow-xs space-y-2 text-xs ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Badge del estado con punto de pulso */}
          <span
            data-testid="badge-estado-ws"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider text-[10px] ${
              estado === "CONECTADO"
                ? "bg-[#E6EFE8] dark:bg-emerald-950/60 text-[#3B694A] dark:text-emerald-300 border border-[#4A7C59]/30 dark:border-emerald-800"
                : estado === "CONECTANDO"
                ? "bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                : "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
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
              ? "Conectado"
              : estado === "CONECTANDO"
              ? "Reconectando…"
              : "Sin conexión en tiempo real"}
          </span>
          <span className="text-[#5E5B54] dark:text-slate-400 text-[11px] hidden sm:inline">
            Estado de conexión
          </span>
        </div>

        {mostrarControlesSimulacion && (
          <div className="flex items-center gap-2 text-[11px] text-[#5E5B54] dark:text-slate-400">
            <span>Eventos recibidos: <strong data-testid="conteo-eventos-ws" className="text-[#2C2B28] dark:text-slate-100 font-mono">{totalEventos}</strong></span>
            {ultimoEvento && (
              <span className="hidden md:inline bg-[#F7F5F0] dark:bg-slate-800 px-2 py-0.5 rounded text-[10px] font-mono text-[#2C2B28] dark:text-slate-200 border border-[#DDD8CC] dark:border-slate-700">
                Último evento: {ultimoEvento.nombre} ({ultimoEvento.fecha})
              </span>
            )}
          </div>
        )}
      </div>

      {mostrarControlesSimulacion && (
        <div className="pt-2 border-t border-[#DDD8CC] dark:border-slate-800 flex items-center justify-between text-[11px] text-[#5E5B54] dark:text-slate-300">
          <span>Herramientas de prueba:</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="boton-simular-corte-red"
              disabled={estado !== "CONECTADO"}
              onClick={forzarDesconexion}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded font-semibold border transition ${
                estado === "CONECTADO"
                  ? "bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 cursor-pointer"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-60"
              }`}
              title="Cierra el WebSocket para observar la reconexión con retroceso exponencial"
            >
              <IconoRayo size={13} aria-hidden="true" />
              <span>Simular corte de red</span>
            </button>
            <button
              type="button"
              data-testid="boton-reconectar-ws"
              disabled={estado === "CONECTADO"}
              onClick={reconectar}
              className={`px-2.5 py-1 rounded font-semibold border transition ${
                estado !== "CONECTADO"
                  ? "bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 cursor-pointer"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-60"
              }`}
            >
              Reconectar ahora
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
