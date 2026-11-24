import { useEffect, useState } from "react";

export type Tema = "claro" | "oscuro";

const CLAVE_STORAGE_TEMA = "tema_color";
const EVENTO_CAMBIO_TEMA = "tema:cambio";

export function obtenerTemaActual(): Tema {
  if (typeof window === "undefined") return "claro";

  const persistido = window.localStorage.getItem(CLAVE_STORAGE_TEMA);
  if (persistido === "claro" || persistido === "oscuro") {
    return persistido;
  }

  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "oscuro";
  }

  return "claro";
}

export function aplicarTema(tema: Tema): void {
  if (typeof document === "undefined") return;

  const raiz = document.documentElement;
  if (tema === "oscuro") {
    raiz.classList.add("dark");
  } else {
    raiz.classList.remove("dark");
  }

  try {
    window.localStorage.setItem(CLAVE_STORAGE_TEMA, tema);
  } catch {
    // LocalStorage puede no estar disponible en entornos restringidos
  }

  window.dispatchEvent(new CustomEvent(EVENTO_CAMBIO_TEMA, { detail: tema }));
}

export function alternarTema(): Tema {
  const actual = obtenerTemaActual();
  const nuevo: Tema = actual === "oscuro" ? "claro" : "oscuro";
  aplicarTema(nuevo);
  return nuevo;
}

export function inicializarTema(): Tema {
  const tema = obtenerTemaActual();
  aplicarTema(tema);
  return tema;
}

export function useTema(): { tema: Tema; alternarTema: () => void } {
  const [tema, setTema] = useState<Tema>(() => obtenerTemaActual());

  useEffect(() => {
    // Sincronizar tema inicial
    inicializarTema();

    const alCambiar = (e: Event) => {
      const custom = e as CustomEvent<Tema>;
      if (custom.detail) {
        setTema(custom.detail);
      } else {
        setTema(obtenerTemaActual());
      }
    };

    window.addEventListener(EVENTO_CAMBIO_TEMA, alCambiar);
    window.addEventListener("storage", alCambiar);

    return () => {
      window.removeEventListener(EVENTO_CAMBIO_TEMA, alCambiar);
      window.removeEventListener("storage", alCambiar);
    };
  }, []);

  return {
    tema,
    alternarTema: () => {
      const nuevo = alternarTema();
      setTema(nuevo);
    },
  };
}
