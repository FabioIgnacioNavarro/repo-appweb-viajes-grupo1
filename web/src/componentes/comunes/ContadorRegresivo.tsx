import React, { useEffect, useState } from "react";

export interface ContadorRegresivoProps {
  expiraEnIso: string;
  etiqueta?: string;
  umbralAlertaSegundos?: number;
  alVencer?: () => void;
  className?: string;
}

function calcularSegundosRestantes(expiraEnIso: string): number {
  const destino = new Date(expiraEnIso).getTime();
  if (!Number.isFinite(destino)) return 0;
  return Math.max(0, Math.floor((destino - Date.now()) / 1000));
}

function formatearMmSs(segundos: number): string {
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  return `${String(min).padStart(2, "0")}:${String(seg).padStart(2, "0")}`;
}

export const ContadorRegresivo: React.FC<ContadorRegresivoProps> = ({
  expiraEnIso,
  etiqueta = "Tiempo restante",
  umbralAlertaSegundos = 30,
  alVencer,
  className = "",
}) => {
  const [restantes, setRestantes] = useState<number>(() => calcularSegundosRestantes(expiraEnIso));

  useEffect(() => {
    const actualizar = () => {
      const s = calcularSegundosRestantes(expiraEnIso);
      setRestantes(s);
      if (s === 0 && alVencer) {
        alVencer();
      }
    };
    actualizar();
    const id = setInterval(actualizar, 1000);
    return () => clearInterval(id);
  }, [expiraEnIso, alVencer]);

  const vencido = restantes <= 0;
  const critico = !vencido && restantes <= umbralAlertaSegundos;

  return (
    <span
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
        vencido
          ? "border-red-200 bg-red-50 text-red-800"
          : critico
            ? "border-amber-300 bg-amber-50 text-amber-900"
            : "border-slate-200 bg-slate-50 text-slate-800"
      } ${className}`}
    >
      <span>{etiqueta}:</span>
      <span className="font-mono font-bold numeros-tabulares">
        {vencido ? "Vencido" : formatearMmSs(restantes)}
      </span>
    </span>
  );
};
