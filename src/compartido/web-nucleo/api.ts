import { DetalleErrorApi, SobreErrorApi } from "./tipos";
import { cerrarSesion, obtenerToken } from "./sesion";

export class ErrorHttpApi extends Error {
  public readonly status: number;
  public readonly codigo: string;
  public readonly mensaje: string;
  public readonly detalles: Record<string, unknown>;

  constructor(status: number, error: DetalleErrorApi) {
    super(error.mensaje || `Error HTTP ${status}`);
    this.name = "ErrorHttpApi";
    this.status = status;
    this.codigo = error.codigo || `HTTP_${status}`;
    this.mensaje = error.mensaje || `Error HTTP ${status}`;
    this.detalles = error.detalles || {};
  }
}

export interface OpcionesPeticion extends RequestInit {
  claveIdempotencia?: string;
  sinToken?: boolean;
}

/**
 * Genera una clave de idempotencia pseudo-aleatoria (formato UUID v4)
 */
export function generarClaveIdempotencia(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "idem-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
}

/**
 * Resuelve la URL base según el entorno (por defecto relativa para usar proxy de Vite o Nginx)
 */
function obtenerBaseUrl(): string {
  if (typeof window !== "undefined") {
    const variable = (window as unknown as { __ENV__?: { VITE_API_URL?: string } }).__ENV__?.VITE_API_URL;
    if (variable) return variable.replace(/\/$/, "");
  }
  return "";
}

/**
 * Ejecuta una petición HTTP contra el API Gateway, inyectando token y manejando errores uniformes
 */
export async function peticionHttp<T = unknown>(
  ruta: string,
  opciones: OpcionesPeticion = {}
): Promise<T> {
  const urlBase = obtenerBaseUrl();
  const urlFinal = ruta.startsWith("http") ? ruta : `${urlBase}${ruta.startsWith("/") ? ruta : `/${ruta}`}`;

  const encabezados = new Headers(opciones.headers || {});

  // Inyectar Content-Type por defecto si hay cuerpo JSON
  if (opciones.body && typeof opciones.body === "string" && !encabezados.has("Content-Type")) {
    encabezados.set("Content-Type", "application/json");
  }

  // Inyectar token Bearer si existe y no se omitió explícitamente
  if (!opciones.sinToken) {
    const token = obtenerToken();
    if (token && !encabezados.has("Authorization")) {
      encabezados.set("Authorization", `Bearer ${token}`);
    }
  }

  // Inyectar clave de idempotencia si se proveyó
  if (opciones.claveIdempotencia) {
    encabezados.set("Clave-Idempotencia", opciones.claveIdempotencia);
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(urlFinal, {
      ...opciones,
      headers: encabezados,
    });
  } catch (err) {
    throw new ErrorHttpApi(0, {
      codigo: "FALLA_RED",
      mensaje: "No se pudo conectar con el servidor o el gateway Nginx.",
      detalles: { errorOriginal: String(err) },
    });
  }

  // Caso 204 No Content
  if (respuesta.status === 204) {
    return {} as T;
  }

  // Intentar parsear respuesta JSON
  let cuerpoJson: unknown = null;
  const texto = await respuesta.text();
  if (texto) {
    try {
      cuerpoJson = JSON.parse(texto);
    } catch {
      cuerpoJson = { mensaje: texto };
    }
  }

  // Si la respuesta fue exitosa (2xx)
  if (respuesta.ok) {
    return cuerpoJson as T;
  }

  // Procesar sobre uniforme de error { error: { codigo, mensaje, detalles } }
  let detalleError: DetalleErrorApi;
  if (cuerpoJson && typeof cuerpoJson === "object" && "error" in cuerpoJson) {
    detalleError = (cuerpoJson as SobreErrorApi).error;
  } else if (cuerpoJson && typeof cuerpoJson === "object" && "mensaje" in cuerpoJson) {
    detalleError = {
      codigo: `HTTP_${respuesta.status}`,
      mensaje: String((cuerpoJson as Record<string, unknown>).mensaje),
      detalles: {},
    };
  } else {
    detalleError = {
      codigo: `HTTP_${respuesta.status}`,
      mensaje: `El servidor devolvió status ${respuesta.status}.`,
      detalles: {},
    };
  }

  // Si el token expiró o es inválido en backend (401), cerrar sesión local
  if (respuesta.status === 401) {
    cerrarSesion();
  }

  throw new ErrorHttpApi(respuesta.status, detalleError);
}

/**
 * Métodos semánticos del cliente API
 */
export const clienteApi = {
  get: <T = unknown>(ruta: string, opciones?: OpcionesPeticion) =>
    peticionHttp<T>(ruta, { ...opciones, method: "GET" }),

  post: <T = unknown>(ruta: string, cuerpo?: unknown, opciones?: OpcionesPeticion) =>
    peticionHttp<T>(ruta, {
      ...opciones,
      method: "POST",
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),

  put: <T = unknown>(ruta: string, cuerpo?: unknown, opciones?: OpcionesPeticion) =>
    peticionHttp<T>(ruta, {
      ...opciones,
      method: "PUT",
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),

  patch: <T = unknown>(ruta: string, cuerpo?: unknown, opciones?: OpcionesPeticion) =>
    peticionHttp<T>(ruta, {
      ...opciones,
      method: "PATCH",
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),

  delete: <T = unknown>(ruta: string, opciones?: OpcionesPeticion) =>
    peticionHttp<T>(ruta, { ...opciones, method: "DELETE" }),
};
