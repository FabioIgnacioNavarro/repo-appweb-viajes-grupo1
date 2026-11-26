import { useEffect, useState } from "react";

const CLAVE_STORAGE_MODO_DEV = "modo_desarrollador";
const EVENTO_CAMBIO_MODO_DEV = "modo-dev:cambio";

export function obtenerModoDesarrollador(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(CLAVE_STORAGE_MODO_DEV) === "true";
}

export function establecerModoDesarrollador(activo: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLAVE_STORAGE_MODO_DEV, activo ? "true" : "false");
  } catch {
    // LocalStorage puede no estar disponible en entornos restringidos
  }
  window.dispatchEvent(new CustomEvent(EVENTO_CAMBIO_MODO_DEV, { detail: activo }));
}

export function alternarModoDesarrollador(): boolean {
  const nuevo = !obtenerModoDesarrollador();
  establecerModoDesarrollador(nuevo);
  return nuevo;
}

export function useModoDesarrollador(): {
  modoDev: boolean;
  alternarModoDev: () => void;
  establecerModoDev: (activo: boolean) => void;
} {
  const [modoDev, setModoDev] = useState<boolean>(() => obtenerModoDesarrollador());

  useEffect(() => {
    const alCambiar = (evento: Event) => {
      const custom = evento as CustomEvent<boolean>;
      if (typeof custom.detail === "boolean") {
        setModoDev(custom.detail);
      } else {
        setModoDev(obtenerModoDesarrollador());
      }
    };
    window.addEventListener(EVENTO_CAMBIO_MODO_DEV, alCambiar);
    window.addEventListener("storage", alCambiar);
    return () => {
      window.removeEventListener(EVENTO_CAMBIO_MODO_DEV, alCambiar);
      window.removeEventListener("storage", alCambiar);
    };
  }, []);

  return {
    modoDev,
    alternarModoDev: () => {
      const nuevo = alternarModoDesarrollador();
      setModoDev(nuevo);
    },
    establecerModoDev: (activo: boolean) => {
      establecerModoDesarrollador(activo);
      setModoDev(activo);
    },
  };
}
