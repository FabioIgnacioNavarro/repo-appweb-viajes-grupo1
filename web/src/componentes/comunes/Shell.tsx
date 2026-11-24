import React, { useEffect, useState } from "react";
import { useRouter } from "../../nucleo/router";
import { cerrarSesion, obtenerSesion, suscribirSesion } from "../../nucleo/sesion";
import { clienteTiempoReal, EstadoConexionWs } from "../../nucleo/ws";
import { UsuarioSesion } from "../../nucleo/tipos";
import { useTema } from "../../nucleo/tema";
import { IconoAuto } from "./Iconos";

export const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { rutaActual, navegarA } = useRouter();
  const [sesion, setSesion] = useState<UsuarioSesion | null>(obtenerSesion());
  const [estadoWs, setEstadoWs] = useState<EstadoConexionWs>(clienteTiempoReal.obtenerEstado());
  const { tema, alternarTema } = useTema();

  useEffect(() => {
    const desuscribirSesion = suscribirSesion(setSesion);
    const desuscribirWs = clienteTiempoReal.alCambiarEstado(setEstadoWs);

    if (obtenerSesion()) {
      clienteTiempoReal.conectar();
    }

    return () => {
      desuscribirSesion();
      desuscribirWs();
    };
  }, []);

  const badgeColorRol = (rol: string) => {
    switch (rol) {
      case "PASAJERO":
        return "bg-blue-50 text-blue-800 border-blue-200";
      case "CHOFER":
        return "bg-emerald-50 text-emerald-800 border-emerald-200";
      case "SOPORTE":
        return "bg-purple-50 text-purple-800 border-purple-200";
      case "ADMINISTRADOR":
        return "bg-amber-50 text-amber-900 border-amber-200";
      default:
        return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  const pillWs = () => {
    if (estadoWs === "CONECTADO") {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200"
          title="Canal WebSocket en tiempo real activo"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true"></span>
          En vivo
        </span>
      );
    }
    if (estadoWs === "CONECTANDO") {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full bg-amber-50 text-amber-900 border border-amber-200"
          title="Reconectando WebSocket..."
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true"></span>
          Conectando...
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-700 border border-slate-200"
        title="Canal WebSocket desconectado"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" aria-hidden="true"></span>
        Desconectado
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
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-slate-900 dark:focus:bg-slate-100 focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-white dark:focus:text-slate-900"
      >
        Saltar al contenido principal
      </a>

      {/* Barra de Navegación Superior */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40 transition-colors">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-wrap items-center justify-between gap-2">
          {/* Logo y Nombre */}
          <button
            type="button"
            className="flex items-center gap-2.5 cursor-pointer text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 min-w-0"
            onClick={() => navegarA(sesion ? "pasajero" : "login")}
          >
            <div className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center shrink-0">
              <IconoAuto size={20} />
            </div>
            <div className="min-w-0 truncate">
              <span className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-lg tracking-tight">Viajes Compartidos</span>
              <span className="hidden sm:inline-block ml-2 text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                Grupo 1
              </span>
            </div>
          </button>

          {/* Menú derecho */}
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 max-w-full">
            {/* Selector Claro / Oscuro */}
            <button
              type="button"
              onClick={alternarTema}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center px-2 py-1.5 text-xs font-semibold rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 transition cursor-pointer"
              title={tema === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              aria-label={tema === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              data-testid="boton-tema"
            >
              {tema === "oscuro" ? "☀️" : "🌙"}
            </button>

            {sesion ? (
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
                    className="order-last sm:order-none w-full md:w-auto flex items-center gap-1 overflow-x-auto text-sm bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    {enlacesAdmin.map((item) => (
                      <button
                        key={item.ruta}
                        type="button"
                        onClick={() => navegarA(item.ruta)}
                        className={`flex-1 md:flex-none px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                          rutaActual === item.ruta
                            ? "bg-white dark:bg-slate-900 shadow-xs text-indigo-700 dark:text-indigo-400 font-semibold"
                            : "text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                        }`}
                      >
                        {item.etiqueta}
                      </button>
                    ))}
                  </nav>
                )}

                <button
                  type="button"
                  onClick={() => {
                    clienteTiempoReal.desconectar();
                    cerrarSesion();
                    navegarA("login");
                  }}
                  className="min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 transition cursor-pointer"
                  title="Cerrar sesión"
                >
                  Salir
                </button>
              </>
            ) : (
              <span className="text-xs text-slate-600 dark:text-slate-400 font-medium text-right">Modo Seguro · Autenticación Externa</span>
            )}
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <main id="contenido-principal" tabIndex={-1} className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-6 focus:outline-none">
        {children}
      </main>

      {/* Pie de Página */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-4 text-center text-xs text-slate-600 dark:text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Programación IV — Trabajo Práctico de Microservicios</span>
          <span className="text-slate-500 dark:text-slate-400">Variante A (Precio Dinámico) · Arquitectura Hexagonal</span>
        </div>
      </footer>
    </div>
  );
};
