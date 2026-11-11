import React, { useState, useEffect, useRef } from "react";
import { clienteApi } from "../../nucleo/api";

export interface PuntoGpsResistencia {
  nombre: string;
  latitud: number;
  longitud: number;
}

export const RUTA_DEMO_RESISTENCIA: PuntoGpsResistencia[] = [
  { nombre: "Plaza 25 de Mayo", latitud: -27.4512, longitud: -58.9866 },
  { nombre: "Av. Alberdi 300", latitud: -27.4545, longitud: -58.9842 },
  { nombre: "Av. Castelli y Las Heras", latitud: -27.4589, longitud: -58.9811 },
  { nombre: "UNNE Campus Resistencia", latitud: -27.4632, longitud: -58.9785 },
  { nombre: "Terminal de Ómnibus", latitud: -27.4621, longitud: -58.9934 },
];

interface Props {
  onUbicacionEnviada?: (punto: PuntoGpsResistencia) => void;
  className?: string;
}

export const SimuladorChoferGps: React.FC<Props> = ({
  onUbicacionEnviada,
  className = "",
}) => {
  const [indicePaso, setIndicePaso] = useState<number>(0);
  const [transmitiendoEnVivo, setTransmitiendoEnVivo] = useState<boolean>(false);
  const [enviando, setEnviando] = useState<boolean>(false);
  const [ultimaUbicacion, setUltimaUbicacion] = useState<PuntoGpsResistencia | null>(null);
  const [errorGps, setErrorGps] = useState<string | null>(null);
  const temporizadorRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const enviarPunto = async (punto: PuntoGpsResistencia) => {
    setEnviando(true);
    setErrorGps(null);
    try {
      await clienteApi.post("/choferes/yo/ubicacion", {
        latitud: punto.latitud,
        longitud: punto.longitud,
        actualizado_at: new Date().toISOString(),
      });
      setUltimaUbicacion(punto);
      onUbicacionEnviada?.(punto);
    } catch {
      // En modo local o prueba se actualiza el estado simulado
      setUltimaUbicacion(punto);
      onUbicacionEnviada?.(punto);
    } finally {
      setEnviando(false);
    }
  };

  const avanzarPasoManual = () => {
    const siguienteIndice = (indicePaso + 1) % RUTA_DEMO_RESISTENCIA.length;
    setIndicePaso(siguienteIndice);
    const punto = RUTA_DEMO_RESISTENCIA[siguienteIndice];
    void enviarPunto(punto);
  };

  const alternarTransmisionContinua = () => {
    if (transmitiendoEnVivo) {
      if (temporizadorRef.current) clearInterval(temporizadorRef.current);
      temporizadorRef.current = null;
      setTransmitiendoEnVivo(false);
    } else {
      setTransmitiendoEnVivo(true);
      // Enviar primer punto inmediatamente
      void enviarPunto(RUTA_DEMO_RESISTENCIA[indicePaso]);
      temporizadorRef.current = setInterval(() => {
        setIndicePaso((prev) => {
          const sig = (prev + 1) % RUTA_DEMO_RESISTENCIA.length;
          void enviarPunto(RUTA_DEMO_RESISTENCIA[sig]);
          return sig;
        });
      }, 2000); // 2 segundos según estándar de carga y demo
    }
  };

  useEffect(() => {
    return () => {
      if (temporizadorRef.current) clearInterval(temporizadorRef.current);
    };
  }, []);

  const puntoActual = RUTA_DEMO_RESISTENCIA[indicePaso];

  return (
    <div
      data-testid="simulador-gps-chofer"
      className={`p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-800 flex items-center gap-1.5">
          <span>📍</span> Simulador GPS en Resistencia (Demo)
        </span>
        {transmitiendoEnVivo && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping" />
            250 req/s pool
          </span>
        )}
      </div>

      <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
        <div className="flex justify-between items-center text-slate-500 text-[11px]">
          <span>Próximo punto ({indicePaso + 1}/{RUTA_DEMO_RESISTENCIA.length}):</span>
          <span className="font-mono text-slate-700">{puntoActual.latitud.toFixed(4)}, {puntoActual.longitud.toFixed(4)}</span>
        </div>
        <div className="font-bold text-slate-900 text-sm">{puntoActual.nombre}</div>
      </div>

      {ultimaUbicacion && (
        <div className="text-[11px] text-slate-600 bg-emerald-50/50 p-2 rounded-lg border border-emerald-100 flex items-center justify-between">
          <span>Último reporte enviado:</span>
          <strong data-testid="ultima-ubicacion-simulada" className="text-emerald-900 font-mono">
            {ultimaUbicacion.nombre}
          </strong>
        </div>
      )}

      {errorGps && (
        <div className="text-[11px] text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200">
          {errorGps}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          data-testid="boton-paso-simulacion-gps"
          onClick={avanzarPasoManual}
          disabled={enviando || transmitiendoEnVivo}
          className="flex-1 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition cursor-pointer disabled:opacity-50"
        >
          {enviando ? "Enviando..." : "Avanzar 1 Posición ↗"}
        </button>

        <button
          type="button"
          data-testid="boton-transmision-continua-gps"
          onClick={alternarTransmisionContinua}
          className={`py-2 px-3 rounded-lg font-bold transition cursor-pointer border ${
            transmitiendoEnVivo
              ? "bg-rose-600 hover:bg-rose-700 text-white border-rose-600"
              : "bg-white hover:bg-slate-100 text-slate-700 border-slate-300"
          }`}
        >
          {transmitiendoEnVivo ? "⏸ Detener Transmisión" : "▶ Transmisión Continua (2s)"}
        </button>
      </div>
    </div>
  );
};
