import React from "react";
import { useRouter } from "../../nucleo/router";
import { obtenerSesion } from "../../nucleo/sesion";
import { Boton, IconoEscudo } from "../../componentes/comunes";

export const VistaNoAutorizado: React.FC = () => {
  const { navegarA, rutaPorDefectoParaRol } = useRouter();
  const sesion = obtenerSesion();

  return (
    <div className="max-w-lg mx-auto py-12 text-center space-y-5" data-testid="vista-no-autorizado">
      <div className="w-16 h-16 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-center mx-auto">
        <IconoEscudo size={28} />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          Acceso No Autorizado (403 Forbidden)
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          Tu rol actual ({sesion?.rol || "Sin rol"}) no posee permisos para acceder a este panel.
          La plataforma valida la autorización en el backend y protege cada recurso de forma estricta.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
        {sesion && (
          <Boton variante="primario" onClick={() => navegarA(rutaPorDefectoParaRol(sesion.rol))}>
            Ir a mi panel ({sesion.rol})
          </Boton>
        )}
        <Boton variante="secundario" onClick={() => navegarA("login")}>
          Cambiar de usuario
        </Boton>
      </div>
    </div>
  );
};
