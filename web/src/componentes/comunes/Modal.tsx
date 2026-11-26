import React, { useEffect, useId } from "react";

export interface ModalProps {
  abierto: boolean;
  titulo: string;
  onCerrar: () => void;
  pie?: React.ReactNode;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ abierto, titulo, onCerrar, pie, children }) => {
  const idTitulo = useId();

  useEffect(() => {
    if (!abierto) return;
    const manejarTecla = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        onCerrar();
      }
    };
    window.addEventListener("keydown", manejarTecla);
    return () => window.removeEventListener("keydown", manejarTecla);
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className="w-full max-w-lg rounded-2xl border border-[#DDD8CC] dark:border-slate-800 bg-[#EFECE4] dark:bg-slate-900 p-5 sm:p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto text-[#2C2B28] dark:text-slate-100"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#DDD8CC] dark:border-slate-800 pb-3">
          <h2 id={idTitulo} className="text-base font-bold text-[#2C2B28] dark:text-slate-100">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar ventana"
            className="min-h-[36px] min-w-[36px] rounded-lg text-[#5E5B54] dark:text-slate-400 hover:bg-[#E5E0D4] dark:hover:bg-slate-800 hover:text-[#2C2B28] dark:hover:text-slate-100 text-sm font-bold cursor-pointer"
          >
            &times;
          </button>
        </div>

        <div className="text-xs sm:text-sm text-[#2C2B28] dark:text-slate-200">{children}</div>

        {pie && <div className="flex flex-wrap justify-end gap-2 border-t border-[#DDD8CC] dark:border-slate-800 pt-3">{pie}</div>}
      </div>
    </div>
  );
};
