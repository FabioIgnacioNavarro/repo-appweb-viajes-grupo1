import { inyectarContextoW3C, obtenerContextoTraza, conSpan } from "./observabilidad";

export class ErrorDependenciaHttp extends Error {
  constructor(readonly servicio: string, readonly operacion: string, readonly estadoHttp?: number) {
    super("Una dependencia necesaria no está disponible.");
    this.name = "ErrorDependenciaHttp";
  }
}

export interface OpcionesClienteHttp {
  timeoutMs?: number;
  reintentos?: number;
  obtener?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  registrarError?: (evento: { servicio: string; operacion: string; resultado: string; traceId?: string; spanId?: string }) => void;
}

export function registrarFallaDependencia(servicio: string, operacion: string, resultado: string): void {
  const traza = obtenerContextoTraza();
  console.error(JSON.stringify({ evento: "dependencia_http_fallida", servicio, operacion, resultado, ...traza }));
}

/** Transporte común para GET internos: reintento acotado y errores sin URL, token ni cuerpo. */
export class ClienteServiciosHttp {
  private readonly obtener: typeof fetch;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly reintentos: number;
  private readonly registrarError: NonNullable<OpcionesClienteHttp["registrarError"]>;

  constructor(opciones: OpcionesClienteHttp = {}) {
    this.timeoutMs = opciones.timeoutMs ?? 1500;
    this.reintentos = opciones.reintentos ?? 1;
    this.obtener = opciones.obtener ?? fetch;
    this.esperar = opciones.esperar ?? ((ms) => new Promise((resolver) => setTimeout(resolver, ms)));
    this.registrarError = opciones.registrarError ?? ((evento) => registrarFallaDependencia(evento.servicio, evento.operacion, evento.resultado));
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || !Number.isInteger(this.reintentos) || this.reintentos < 0 || this.reintentos > 1) {
      throw new Error("La configuración del cliente de dependencias es inválida.");
    }
  }

  async getJson<T>(servicio: string, operacion: string, url: string, jwt: string, permitir404 = false): Promise<T> {
    return conSpan(`dependencia.${servicio}.${operacion}`, { "servicio.destino": servicio, operacion }, async () => {
      for (let intento = 0; intento <= this.reintentos; intento += 1) {
        let respuesta: Response;
        try {
          const encabezados: Record<string, string> = {
            Authorization: `Bearer ${jwt}`,
            Accept: "application/json"
          };
          inyectarContextoW3C(encabezados);

          respuesta = await this.obtener(url, {
            method: "GET",
            headers: encabezados,
            signal: AbortSignal.timeout(this.timeoutMs)
          });
        } catch {
          if (intento < this.reintentos) {
            await this.esperar(100);
            continue;
          }
          const traza = obtenerContextoTraza();
          this.registrarError({ servicio, operacion, resultado: "timeout_o_red", ...traza });
          throw new ErrorDependenciaHttp(servicio, operacion);
        }

        if (respuesta.ok) {
          try {
            return await respuesta.json() as T;
          } catch {
            const traza = obtenerContextoTraza();
            this.registrarError({ servicio, operacion, resultado: "json_invalido", ...traza });
            throw new ErrorDependenciaHttp(servicio, operacion);
          }
        }

        if (respuesta.status === 404 && permitir404) return undefined as T;

        if ([429, 502, 503, 504].includes(respuesta.status) && intento < this.reintentos) {
          await this.esperar(100);
          continue;
        }

        if (respuesta.status >= 500 || respuesta.status === 429) {
          const traza = obtenerContextoTraza();
          this.registrarError({ servicio, operacion, resultado: `http_${respuesta.status}`, ...traza });
          throw new ErrorDependenciaHttp(servicio, operacion, respuesta.status);
        }

        // 401/403 y errores de contrato no se ocultan con un reintento ni se convierten en éxito.
        const traza = obtenerContextoTraza();
        this.registrarError({ servicio, operacion, resultado: `rechazo_${respuesta.status}`, ...traza });
        throw new ErrorDependenciaHttp(servicio, operacion, respuesta.status);
      }

      throw new ErrorDependenciaHttp(servicio, operacion);
    });
  }
}

export function exigirBaseInterna(valor: string | undefined, nombre: string): string {
  if (!valor) throw new Error(`${nombre} es obligatoria.`);
  const url = new URL(valor);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${nombre} debe ser una URL HTTP(S) base válida.`);
  }
  return url.toString().replace(/\/$/, "");
}
