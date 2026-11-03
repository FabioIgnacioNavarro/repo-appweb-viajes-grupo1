import React, { useEffect, useState } from "react";
import { useRouter } from "../../nucleo/router";
import { cerrarSesion, obtenerSesion, suscribirSesion } from "../../nucleo/sesion";
import { clienteTiempoReal, EstadoConexionWs } from "../../nucleo/ws";
import { UsuarioSesion } from "../../nucleo/tipos";

export const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { rutaActual, navegarA } = useRouter();
  const [sesion, setSesion] = useState<UsuarioSesion | null>(obtenerSesion());
  const [estadoWs, setEstadoWs] = useState<EstadoConexionWs>(clienteTiempoReal.obtenerEstado());

  useEffect(() => {
    const desuscribirSesion = suscribirSesion(setSesion);
    const desuscribirWs = clienteTiempoReal.alCambiarEstado(setEstadoWs);

    // Conectar WebSocket si hay sesión activa
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
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "CHOFER":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "SOPORTE":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "ADMINISTRADOR":
        return "bg-amber-100 text-amber-800 border-amber-200";
      default:
        return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  const pillWs = () => {
    if (estadoWs === "CONECTADO") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200" title="Canal WebSocket en tiempo real activo">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          En vivo
        </span>
      );
    }
    if (estadoWs === "CONECTANDO") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200" title="Reconectando WebSocket...">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
          Conectando...
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600 border border-slate-200" title="Canal WebSocket desconectado">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
        Desconectado
      </span>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Barra de Navegación Superior */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo y Nombre */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navegarA(sesion ? "pasajero" : "login")}>
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
              🚗
            </div>
            <div>
              <span className="font-bold text-slate-900 text-base sm:text-lg tracking-tight">Viajes Compartidos</span>
              <span className="hidden sm:inline-block ml-2 text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                Grupo 1
              </span>
            </div>
          </div>

          {/* Menú derecho */}
          <div className="flex items-center gap-2 sm:gap-4">
            {sesion ? (
              <>
                {/* Estado WebSocket */}
                <div className="hidden sm:block">{pillWs()}</div>

                {/* Rol Badge */}
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-md border uppercase tracking-wider ${badgeColorRol(sesion.rol)}`}>
                  {sesion.rol}
                </span>

                {/* Navegación para administradores */}
                {sesion.rol === "ADMINISTRADOR" && (
                  <nav className="hidden md:flex items-center gap-1 text-sm bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button
                      onClick={() => navegarA("pasajero")}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${rutaActual === "pasajero" ? "bg-white shadow-xs text-indigo-700" : "text-slate-600 hover:text-slate-900"}`}
                    >
                      Pasajero
                    </button>
                    <button
                      onClick={() => navegarA("chofer")}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${rutaActual === "chofer" ? "bg-white shadow-xs text-indigo-700" : "text-slate-600 hover:text-slate-900"}`}
                    >
                      Chofer
                    </button>
                    <button
                      onClick={() => navegarA("operador")}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${rutaActual === "operador" ? "bg-white shadow-xs text-indigo-700" : "text-slate-600 hover:text-slate-900"}`}
                    >
                      Operador
                    </button>
                    <button
                      onClick={() => navegarA("admin")}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${rutaActual === "admin" ? "bg-white shadow-xs text-indigo-700" : "text-slate-600 hover:text-slate-900"}`}
                    >
                      Admin
                    </button>
                  </nav>
                )}

                {/* Botón Salir */}
                <button
                  onClick={() => {
                    clienteTiempoReal.desconectar();
                    cerrarSesion();
                    navegarA("login");
                  }}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-700 hover:bg-slate-100 border border-slate-200 transition"
                  title="Cerrar sesión"
                >
                  Salir
                </button>
              </>
            ) : (
              <span className="text-xs text-slate-500 font-medium">Modo Seguro · Autenticación Externa</span>
            )}
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      {/* Pie de Página */}
      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Programación IV — Trabajo Práctico de Microservicios</span>
          <span className="text-slate-400">Variante A (Precio Dinámico) · Arquitectura Hexagonal</span>
        </div>
      </footer>
    </div>
  );
};
