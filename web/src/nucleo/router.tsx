import React, { createContext, useContext, useEffect, useState } from "react";
import { Rol } from "./tipos";
import { estaAutenticado, obtenerSesion, suscribirSesion } from "./sesion";

export type Ruta = "login" | "pasajero" | "chofer" | "operador" | "admin" | "no_autorizado";

interface ContextoRouter {
  rutaActual: Ruta;
  navegarA: (ruta: Ruta) => void;
  rutaPorDefectoParaRol: (rol: Rol) => Ruta;
}

const ContextoNavegacion = createContext<ContextoRouter | null>(null);

function obtenerRutaDesdeHash(): Ruta {
  if (typeof window === "undefined") return "login";
  const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (hash === "pasajero") return "pasajero";
  if (hash === "chofer") return "chofer";
  if (hash === "operador") return "operador";
  if (hash === "admin") return "admin";
  if (hash === "no_autorizado") return "no_autorizado";
  return "login";
}

export function rutaPorDefectoParaRol(rol: Rol): Ruta {
  switch (rol) {
    case "PASAJERO":
      return "pasajero";
    case "CHOFER":
      return "chofer";
    case "SOPORTE":
      return "operador";
    case "ADMINISTRADOR":
      return "admin";
    default:
      return "login";
  }
}

const REGLAS_ROLES: Record<Ruta, Rol[] | null> = {
  login: null, // Público
  pasajero: ["PASAJERO", "ADMINISTRADOR"],
  chofer: ["CHOFER", "ADMINISTRADOR"],
  operador: ["SOPORTE", "ADMINISTRADOR"],
  admin: ["ADMINISTRADOR"],
  no_autorizado: null,
};

export const ProveedorRouter: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [rutaActual, setRutaActual] = useState<Ruta>(obtenerRutaDesdeHash());

  const evaluarGuarda = (rutaDestino: Ruta): Ruta => {
    const sesion = obtenerSesion();
    const rolesPermitidos = REGLAS_ROLES[rutaDestino];

    // Si es login y ya está autenticado, ir a su vista natural
    if (rutaDestino === "login" && sesion) {
      return rutaPorDefectoParaRol(sesion.rol);
    }

    // Si la ruta requiere roles
    if (rolesPermitidos) {
      if (!sesion) {
        return "login";
      }
      if (!rolesPermitidos.includes(sesion.rol)) {
        return "no_autorizado";
      }
    }

    return rutaDestino;
  };

  const navegarA = (ruta: Ruta) => {
    const rutaValida = evaluarGuarda(ruta);
    window.location.hash = `#/${rutaValida}`;
    setRutaActual(rutaValida);
  };

  useEffect(() => {
    const alCambiarHash = () => {
      const ruta = obtenerRutaDesdeHash();
      const rutaValida = evaluarGuarda(ruta);
      if (ruta !== rutaValida) {
        window.location.hash = `#/${rutaValida}`;
      }
      setRutaActual(rutaValida);
    };

    // Escuchar hashchange
    window.addEventListener("hashchange", alCambiarHash);

    // Escuchar cambios de sesión (login / logout)
    const desuscribir = suscribirSesion((sesion) => {
      if (!sesion) {
        window.location.hash = "#/login";
        setRutaActual("login");
      } else {
        const ruta = obtenerRutaDesdeHash();
        if (ruta === "login" || ruta === "no_autorizado") {
          const porDefecto = rutaPorDefectoParaRol(sesion.rol);
          window.location.hash = `#/${porDefecto}`;
          setRutaActual(porDefecto);
        } else {
          alCambiarHash();
        }
      }
    });

    // Validación inicial
    alCambiarHash();

    return () => {
      window.removeEventListener("hashchange", alCambiarHash);
      desuscribir();
    };
  }, []);

  return (
    <ContextoNavegacion.Provider value={{ rutaActual, navegarA, rutaPorDefectoParaRol }}>
      {children}
    </ContextoNavegacion.Provider>
  );
};

export function useRouter(): ContextoRouter {
  const ctx = useContext(ContextoNavegacion);
  if (!ctx) {
    throw new Error("useRouter debe usarse dentro de ProveedorRouter");
  }
  return ctx;
}
