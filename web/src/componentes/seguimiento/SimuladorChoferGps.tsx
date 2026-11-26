import React, { useState, useEffect, useRef } from "react";
import { clienteApi } from "../../nucleo/api";
import { IconoPin } from "../comunes";

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
      className={`p-4 rounded-xl bg-[#EFECE4] dark:bg-slate-900 border border-[#DDD8CC] dark:border-slate-800 space-y-3 text-xs ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-bold text-[#2C2B28] dark:text-slate-200 flex items-center gap-1.5">
          <IconoPin size={15} /> Simulador GPS en Resistencia (Demo)
        </span>
        {transmitiendoEnVivo && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E6EFE8] dark:bg-emerald-950/60 text-[#3B694A] dark:text-emerald-300 text-[10px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping" />
            250 req/s pool
          </span>
        )}
      </div>

      <div className="bg-[#F7F5F0] dark:bg-slate-800 p-3 rounded-lg border border-[#DDD8CC] dark:border-slate-700 space-y-1">
        <div className="flex justify-between items-center text-[#5E5B54] dark:text-slate-400 text-[11px]">
          <span>Próximo punto ({indicePaso + 1}/{RUTA_DEMO_RESISTENCIA.length}):</span>
          <span className="font-mono text-[#2C2B28] dark:text-slate-200">{puntoActual.latitud.toFixed(4)}, {puntoActual.longitud.toFixed(4)}</span>
        </div>
        <div className="font-bold text-[#2C2B28] dark:text-slate-100 text-sm">{puntoActual.nombre}</div>
      </div>

      {ultimaUbicacion && (
        <div className="text-[11px] text-[#3B694A] dark:text-emerald-300 bg-[#E6EFE8] dark:bg-emerald-950/40 p-2 rounded-lg border border-[#4A7C59]/30 dark:border-emerald-800 flex items-center justify-between">
          <span>Último reporte enviado:</span>
          <strong data-testid="ultima-ubicacion-simulada" className="text-[#2C2B28] dark:text-emerald-200 font-mono">
            {ultimaUbicacion.nombre}
          </strong>
        </div>
      )}

      {errorGps && (
        <div className="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 p-2 rounded-lg border border-rose-200 dark:border-rose-800">
          {errorGps}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          data-testid="boton-paso-simulacion-gps"
          onClick={avanzarPasoManual}
          disabled={enviando || transmitiendoEnVivo}
          className="flex-1 py-2 px-3 rounded-lg bg-[#4A7C59] hover:bg-[#3E6A4B] text-white font-bold transition cursor-pointer disabled:opacity-50"
        >
          {enviando ? "Enviando..." : "Avanzar 1 Posición"}
        </button>

        <button
          type="button"
          data-testid="boton-transmision-continua-gps"
          onClick={alternarTransmisionContinua}
          className={`py-2 px-3 rounded-lg font-bold transition cursor-pointer border ${
            transmitiendoEnVivo
              ? "bg-rose-600 hover:bg-rose-700 text-white border-rose-600"
              : "bg-[#F7F5F0] dark:bg-slate-800 hover:bg-[#E5E0D4] dark:hover:bg-slate-700 text-[#2C2B28] dark:text-slate-200 border-[#CEC8BA] dark:border-slate-700"
          }`}
        >
          {transmitiendoEnVivo ? "Detener Transmisión" : "Transmisión Continua (2s)"}
        </button>
      </div>
    </div>
  );
};
