import React, { useEffect, useState } from "react";
import { useRouter } from "../../nucleo/router";
import { cerrarSesion, obtenerSesion, suscribirSesion } from "../../nucleo/sesion";
import { clienteTiempoReal, EstadoConexionWs } from "../../nucleo/ws";
import { UsuarioSesion } from "../../nucleo/tipos";
import { useTema } from "../../nucleo/tema";
import { useModoDesarrollador } from "../../nucleo/modoDesarrollador";
import { IconoAuto, IconoCodigo, IconoLuna, IconoSol } from "./Iconos";

export const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { rutaActual, navegarA } = useRouter();
  const [sesion, setSesion] = useState<UsuarioSesion | null>(obtenerSesion());
  const [estadoWs, setEstadoWs] = useState<EstadoConexionWs>(clienteTiempoReal.obtenerEstado());
  const { tema, alternarTema } = useTema();
  const { modoDev, alternarModoDev } = useModoDesarrollador();

  useEffect(() => {
    const desuscribirSesion = suscribirSesion(setSesion);
    const desuscribirWs = clienteTiempoReal.alCambiarEstado(setEstadoWs);

    return () => {
      desuscribirSesion();
      desuscribirWs();
    };
  }, []);

  useEffect(() => {
    if (sesion) {
      clienteTiempoReal.conectar();
    }
  }, [sesion]);

  const badgeColorRol = (rol: string) => {
    switch (rol) {
      case "PASAJERO":
        return "bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800";
      case "CHOFER":
        return "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";
      case "SOPORTE":
        return "bg-purple-50 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800";
      case "ADMINISTRADOR":
        return "bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800";
      default:
        return "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700";
    }
  };

  const pillWs = () => {
    if (estadoWs === "CONECTADO") {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
          title="Conexión en tiempo real activa"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true"></span>
          En vivo
        </span>
      );
    }
    if (estadoWs === "CONECTANDO") {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
          title="Reconectando conexión en tiempo real…"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true"></span>
          Conectando...
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
        title="Sin conexión en tiempo real"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" aria-hidden="true"></span>
        Sin conexión
      </span>
    );
  };

  const enlacesAdmin: Array<{ ruta: "pasajero" | "chofer" | "operador" | "admin"; etiqueta: string }> = [
    { ruta: "pasajero", etiqueta: "Pasajero" },
    { ruta: "chofer", etiqueta: "Chofer" },
    { ruta: "operador", etiqueta: "Operador" },
    { ruta: "admin", etiqueta: "Admin" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F5F0] dark:bg-slate-950 text-[#2C2B28] dark:text-slate-100 transition-colors">
      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-[#4A7C59] dark:focus:bg-slate-100 focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-white dark:focus:text-slate-900"
      >
        Saltar al contenido principal
      </a>

      {/* Barra de Navegación Superior */}
      <header className="bg-[#EFECE4] dark:bg-slate-900 border-b border-[#DDD8CC] dark:border-slate-800 sticky top-0 z-40 transition-colors">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-wrap items-center justify-between gap-2">
          {/* Logo y Nombre */}
          <button
            type="button"
            className="flex items-center gap-2.5 cursor-pointer text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7C59] dark:focus-visible:ring-slate-100 min-w-0"
            onClick={() => navegarA(sesion ? "pasajero" : "login")}
          >
            <div className="w-9 h-9 rounded-xl bg-[#4A7C59] dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center shrink-0">
              <IconoAuto size={20} />
            </div>
            <div className="min-w-0 truncate">
              <span className="font-bold text-[#2C2B28] dark:text-slate-100 text-sm sm:text-lg tracking-tight">Viapp</span>
            </div>
          </button>

          {/* Menú derecho */}
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-2.5 max-w-full">
            {sesion && (
              <>
                <div className="hidden sm:block">{pillWs()}</div>

                <span
                  className={`text-[11px] sm:text-xs font-semibold px-2 sm:px-2.5 py-1 rounded-md border uppercase tracking-wider ${badgeColorRol(sesion.rol)}`}
                >
                  {sesion.rol}
                </span>

                {sesion.rol === "ADMINISTRADOR" && (
                  <nav
                    aria-label="Navegación entre roles"
                    className="order-last sm:order-none w-full md:w-auto flex items-center gap-1 overflow-x-auto text-sm bg-[#E5E0D4] dark:bg-slate-800 p-1 rounded-lg border border-[#DDD8CC] dark:border-slate-700"
                  >
                    {enlacesAdmin.map((item) => (
                      <button
                        key={item.ruta}
                        type="button"
                        onClick={() => navegarA(item.ruta)}
                        className={`flex-1 md:flex-none px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                          rutaActual === item.ruta
                            ? "bg-[#F7F5F0] dark:bg-slate-900 shadow-xs text-[#4A7C59] dark:text-emerald-300 font-semibold"
                            : "text-[#2C2B28] dark:text-slate-300 hover:text-[#4A7C59] dark:hover:text-slate-100"
                        }`}
                      >
                        {item.etiqueta}
                      </button>
                    ))}
                  </nav>
                )}
              </>
            )}

            {/* Selector Claro / Oscuro (icono monocromático) */}
            <button
              type="button"
              onClick={alternarTema}
              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center px-2 py-1.5 text-xs font-semibold rounded-lg text-[#2C2B28] dark:text-slate-200 hover:bg-[#E5E0D4] dark:hover:bg-slate-800 border border-[#CEC8BA] dark:border-slate-700 transition cursor-pointer"
              title={tema === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              aria-label={tema === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              data-testid="boton-tema"
            >
              {tema === "oscuro" ? <IconoSol size={17} /> : <IconoLuna size={17} />}
            </button>

            {/* Toggle global de Modo Desarrollador en la esquina superior derecha */}
            <button
              type="button"
              onClick={alternarModoDev}
              aria-pressed={modoDev}
              data-testid="boton-modo-dev"
              className={`min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition cursor-pointer ${
                modoDev
                  ? "bg-[#4A7C59] text-white border-[#4A7C59] hover:bg-[#3E6A4B] dark:bg-[#4A7C59] dark:border-[#4A7C59] dark:hover:bg-[#578F68]"
                  : "text-[#2C2B28] dark:text-slate-200 border-[#CEC8BA] dark:border-slate-700 hover:bg-[#E5E0D4] dark:hover:bg-slate-800"
              }`}
              title={modoDev ? "Desactivar modo desarrollador" : "Activar modo desarrollador"}
            >
              <IconoCodigo size={15} />
              <span>Modo dev</span>
            </button>

            {sesion && (
              <button
                type="button"
                onClick={() => {
                  clienteTiempoReal.desconectar();
                  cerrarSesion();
                  navegarA("login");
                }}
                className="min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg text-[#2C2B28] dark:text-slate-200 hover:bg-[#E5E0D4] dark:hover:bg-slate-800 border border-[#CEC8BA] dark:border-slate-700 transition cursor-pointer"
                title="Cerrar sesión"
              >
                Salir
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <main id="contenido-principal" tabIndex={-1} className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-6 focus:outline-none">
        {children}
      </main>

      {/* Pie de Página */}
      <footer className="bg-[#EFECE4] dark:bg-slate-900 border-t border-[#DDD8CC] dark:border-slate-800 py-4 text-center text-xs text-[#5E5B54] dark:text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-center">
          <span>Viapp</span>
        </div>
      </footer>
    </div>
  );
};
