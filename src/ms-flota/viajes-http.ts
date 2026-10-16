import { ClienteServiciosHttp, exigirBaseInterna } from "../compartido/cliente-servicios";
import { ErrorFlota, type RepositorioViajesActivos } from "./dominio";

export class RepositorioViajesActivosHttp implements RepositorioViajesActivos {
  private readonly base: string;
  constructor(base: string | undefined, private readonly jwt: string, private readonly http: ClienteServiciosHttp) { this.base = exigirBaseInterna(base, "MS_VIAJES_URL"); }
  async buscarChoferesOcupados(idsChoferes: string[]): Promise<Set<string>> {
    if (idsChoferes.length === 0) return new Set();
    const consulta = new URLSearchParams({ ids_choferes: idsChoferes.slice(0, 100).join(",") });
    try {
      const respuesta = await this.http.getJson<{ ids_choferes_ocupados?: unknown }>("ms-viajes", "consultar_ocupacion", `${this.base}/interno/choferes/ocupados?${consulta}`, this.jwt);
      if (!Array.isArray(respuesta.ids_choferes_ocupados) || respuesta.ids_choferes_ocupados.some((id) => typeof id !== "string" || !idsChoferes.includes(id))) throw new Error("Contrato interno inválido.");
      return new Set(respuesta.ids_choferes_ocupados as string[]);
    } catch { throw new ErrorFlota("DEPENDENCIA_NO_DISPONIBLE", "No se pudo verificar la ocupación de los choferes."); }
  }
}
