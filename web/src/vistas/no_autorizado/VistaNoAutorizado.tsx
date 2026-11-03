import React from "react";
import { useRouter } from "../../nucleo/router";
import { obtenerSesion } from "../../nucleo/sesion";

export const VistaNoAutorizado: React.FC = () => {
  const { navegarA, rutaPorDefectoParaRol } = useRouter();
  const sesion = obtenerSesion();

  return (
    <div className="max-w-lg mx-auto py-12 text-center">
      <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto text-3xl mb-4">
        🚫
      </div>
      <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Acceso No Autorizado (403 Forbidden)</h1>
      <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
        Tu rol actual ({sesion?.rol || "Sin rol"}) no posee permisos para acceder a este panel.
        La plataforma valida la autorización en el backend y protege cada recurso de forma estricta.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        {sesion && (
          <button
            onClick={() => navegarA(rutaPorDefectoParaRol(sesion.rol))}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
          >
            Ir a mi panel ({sesion.rol})
          </button>
        )}
        <button
          onClick={() => navegarA("login")}
          className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer"
        >
          Cambiar de usuario
        </button>
      </div>
    </div>
  );
};
