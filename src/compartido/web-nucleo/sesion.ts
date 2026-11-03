import { Rol, UsuarioSesion } from "./tipos";

const CLAVE_STORAGE = "viajes_grupo1_sesion";

// Suscriptores al cambio de sesión (para reactividad en React y en el Router)
type OyenteSesion = (sesion: UsuarioSesion | null) => void;
const oyentes: Set<OyenteSesion> = new Set();

let sesionEnMemoria: UsuarioSesion | null = null;

function notificarCambio() {
  for (const oyente of oyentes) {
    try {
      oyente(sesionEnMemoria);
    } catch (e) {
      console.error("Error en oyente de sesión:", e);
    }
  }
}

/**
 * Decodifica de forma segura la parte de payload de un JWT
 * Funciona tanto para tokens RS256 estándar (3 partes) como para el modo falso (falso.payload).
 */
export function decodificarPayloadJwt(token: string): Record<string, unknown> {
  const partes = token.trim().split(".");
  if (partes.length < 2) {
    throw new Error("Token malformado.");
  }
  try {
    const partePayload = partes.length === 3 ? partes[1] : partes[partes.length - 1];
    // Decodificar Base64Url
    const base64 = partePayload.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function"
      ? decodeURIComponent(
          atob(base64)
            .split("")
            .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
            .join("")
        )
      : Buffer.from(base64, "base64").toString("utf-8");

    return JSON.parse(json);
  } catch (err) {
    throw new Error("No se pudo decodificar el payload del token JWT.");
  }
}

/**
 * Parsea un rol seguro desde los claims del token
 */
export function extraerRolDesdeClaims(claims: Record<string, unknown>): Rol {
  const candidato = (
    claims.rol ||
    claims.role ||
    (Array.isArray(claims.roles) ? claims.roles[0] : null) ||
    claims["https://viajes-grupo1/rol"]
  );

  if (typeof candidato === "string") {
    const rolMayus = candidato.toUpperCase();
    if (
      rolMayus === "PASAJERO" ||
      rolMayus === "CHOFER" ||
      rolMayus === "SOPORTE" ||
      rolMayus === "ADMINISTRADOR"
    ) {
      return rolMayus as Rol;
    }
  }

  // Si no está explícito, fallback seguro a PASAJERO
  return "PASAJERO";
}

/**
 * Obtiene la sesión actual activa (primero memoria, fallback a sessionStorage)
 */
export function obtenerSesion(): UsuarioSesion | null {
  if (sesionEnMemoria) {
    // Verificar si expiró
    if (sesionEnMemoria.expiraEn > 0 && Date.now() / 1000 > sesionEnMemoria.expiraEn) {
      cerrarSesion();
      return null;
    }
    return sesionEnMemoria;
  }

  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const serializado = window.sessionStorage.getItem(CLAVE_STORAGE);
      if (serializado) {
        const recuperada = JSON.parse(serializado) as UsuarioSesion;
        if (recuperada.expiraEn > 0 && Date.now() / 1000 > recuperada.expiraEn) {
          window.sessionStorage.removeItem(CLAVE_STORAGE);
          return null;
        }
        sesionEnMemoria = recuperada;
        return sesionEnMemoria;
      }
    }
  } catch (e) {
    // Fallback silencioso ante modo privado estricto
  }

  return null;
}

/**
 * Inicia sesión guardando el token y extrayendo los claims del usuario
 */
export function iniciarSesion(token: string, datosOpcionales?: Partial<UsuarioSesion>): UsuarioSesion {
  if (!token || typeof token !== "string") {
    throw new Error("Token JWT inválido o vacío.");
  }

  const claims = decodificarPayloadJwt(token);
  const idUsuario = (
    datosOpcionales?.idUsuario ||
    claims.idUsuario ||
    claims.sub ||
    claims.user_id ||
    claims.uid ||
    "usuario-desconocido"
  ) as string;

  const rol = datosOpcionales?.rol || extraerRolDesdeClaims(claims);
  const expiraEn = typeof claims.exp === "number" ? claims.exp : Math.floor(Date.now() / 1000) + 3600;

  const nuevaSesion: UsuarioSesion = {
    idUsuario,
    rol,
    email: (claims.email as string) || datosOpcionales?.email || `${idUsuario.toLowerCase()}@viajes.local`,
    nombre: (claims.name as string) || datosOpcionales?.nombre || idUsuario,
    token: token.trim(),
    expiraEn,
  };

  sesionEnMemoria = nuevaSesion;

  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem(CLAVE_STORAGE, JSON.stringify(nuevaSesion));
    }
  } catch (e) {
    // En entornos sin storage, se mantiene en memoria
  }

  notificarCambio();
  return nuevaSesion;
}

/**
 * Cierra la sesión activa y notifica a los oyentes
 */
export function cerrarSesion(): void {
  sesionEnMemoria = null;
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.removeItem(CLAVE_STORAGE);
    }
  } catch (e) {
    // Ignorar
  }
  notificarCambio();
}

/**
 * Comprueba si hay una sesión válida no expirada
 */
export function estaAutenticado(): boolean {
  return obtenerSesion() !== null;
}

/**
 * Valida si el usuario actual posee alguno de los roles indicados
 */
export function tieneRol(rolesPermitidos: Rol[]): boolean {
  const sesion = obtenerSesion();
  if (!sesion) return false;
  return rolesPermitidos.includes(sesion.rol);
}

/**
 * Obtiene el token Bearer para llamadas de red
 */
export function obtenerToken(): string | null {
  const sesion = obtenerSesion();
  return sesion ? sesion.token : null;
}

/**
 * Permite suscribirse a cambios en el estado de autenticación
 */
export function suscribirSesion(oyente: OyenteSesion): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}
