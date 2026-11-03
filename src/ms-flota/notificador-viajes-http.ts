import type { ActorAutenticado } from "./dominio";
import type { PublicadorUbicacionViaje } from "./http";
import { inyectarContextoW3C } from "../compartido/observabilidad";

/** Adapta una ubicación ya persistida al endpoint interno efímero de ms-viajes. */
export class NotificadorUbicacionViajesHttp implements PublicadorUbicacionViaje {
  constructor(private readonly baseViajes: string, private readonly timeoutMs = 1500, private readonly obtener: typeof fetch = fetch) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error("TIMEOUT_SERVICIO_MS debe ser un entero positivo.");
  }

  async publicar(_actor: ActorAutenticado, ubicacion: { latitud: number; longitud: number; actualizadoAt: Date }, jwt: string): Promise<void> {
    const encabezados: Record<string, string> = { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", Accept: "application/json" };
    inyectarContextoW3C(encabezados);
    let respuesta: Response;
    try {
      respuesta = await this.obtener(`${this.baseViajes}/interno/viajes/ubicacion-chofer`, {
        method: "POST", headers: encabezados,
        body: JSON.stringify({ latitud: ubicacion.latitud, longitud: ubicacion.longitud, actualizado_at: ubicacion.actualizadoAt.toISOString() }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch { throw new Error("No se pudo publicar la ubicación en tiempo real."); }
    if (!respuesta.ok) throw new Error("No se pudo publicar la ubicación en tiempo real.");
  }
}
