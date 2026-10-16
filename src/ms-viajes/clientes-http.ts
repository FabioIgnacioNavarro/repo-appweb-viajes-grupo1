import { ClienteServiciosHttp, ErrorDependenciaHttp, exigirBaseInterna, registrarFallaDependencia } from "../compartido/cliente-servicios";
import { ErrorDominio, type Coordenada, type EstimacionVigente, type FuenteCandidatos } from "./dominio";

type RespuestaEstimacion = {
  id_estimacion: string; precio_estimado: string; moneda: string; multiplicador_demanda: number;
  factores_precio: Record<string, unknown>; creada_en: string; vigente_hasta: string;
  origen: { latitud: number; longitud: number }; destino: { latitud: number; longitud: number };
};

export class ClienteTarifasHttp {
  private readonly base: string;
  constructor(base: string | undefined, private readonly http: ClienteServiciosHttp) { this.base = exigirBaseInterna(base, "MS_TARIFAS_URL"); }
  async obtenerEstimacion(id: string, jwt: string): Promise<EstimacionVigente | undefined> {
    let respuesta: RespuestaEstimacion | undefined;
    try { respuesta = await this.http.getJson<RespuestaEstimacion>("ms-tarifas", "obtener_estimacion", `${this.base}/estimaciones/${encodeURIComponent(id)}`, jwt, true); }
    catch (error) { if (error instanceof ErrorDependenciaHttp && error.estadoHttp === 409) throw new ErrorDominio("ESTIMACION_VENCIDA", "La estimación ya venció."); throw error; }
    if (!respuesta) return undefined;
    if (respuesta.id_estimacion !== id || respuesta.moneda !== "ARS" || !/^[0-9]+$/.test(respuesta.precio_estimado) || !Number.isFinite(respuesta.multiplicador_demanda) || !fechaValida(respuesta.creada_en) || !fechaValida(respuesta.vigente_hasta) || !coordenadaValida(respuesta.origen) || !coordenadaValida(respuesta.destino) || !respuesta.factores_precio || typeof respuesta.factores_precio !== "object") {
      registrarFallaDependencia("ms-tarifas", "contrato_estimacion", "respuesta_invalida");
      throw new ErrorDependenciaHttp("ms-tarifas", "contrato_estimacion");
    }
    return { id: respuesta.id_estimacion, origen: respuesta.origen, destino: respuesta.destino, precioEstimado: respuesta.precio_estimado,
      moneda: "ARS", multiplicadorDemanda: respuesta.multiplicador_demanda, factoresPrecio: respuesta.factores_precio,
      creadaEn: new Date(respuesta.creada_en), vigenteHasta: new Date(respuesta.vigente_hasta) };
  }
}

export class ClienteFlotaHttp implements FuenteCandidatos {
  private readonly base: string;
  constructor(base: string | undefined, private readonly http: ClienteServiciosHttp, private readonly radioMetros = 5000) {
    this.base = exigirBaseInterna(base, "MS_FLOTA_URL");
    if (!Number.isFinite(radioMetros) || radioMetros <= 0 || radioMetros > 100_000) throw new Error("RADIO_BUSQUEDA_CHOFERES_METROS debe estar entre 1 y 100000.");
  }
  async buscar(origen: Coordenada, jwt: string): Promise<string[]> {
    const parametros = new URLSearchParams({ latitud: String(origen.latitud), longitud: String(origen.longitud), radio_metros: String(this.radioMetros) });
    const respuesta = await this.http.getJson<{ candidatos?: Array<{ id_chofer?: unknown }> }>("ms-flota", "buscar_candidatos", `${this.base}/choferes/cercanos?${parametros}`, jwt);
    if (!Array.isArray(respuesta.candidatos) || respuesta.candidatos.some((c) => typeof c.id_chofer !== "string" || !c.id_chofer)) { registrarFallaDependencia("ms-flota", "contrato_candidatos", "respuesta_invalida"); throw new ErrorDependenciaHttp("ms-flota", "contrato_candidatos"); }
    return respuesta.candidatos.map((c) => c.id_chofer as string);
  }
}

function fechaValida(valor: unknown): valor is string { return typeof valor === "string" && Number.isFinite(Date.parse(valor)); }
function coordenadaValida(valor: unknown): valor is Coordenada { return typeof valor === "object" && valor !== null && "latitud" in valor && "longitud" in valor && Number.isFinite((valor as Coordenada).latitud) && Number.isFinite((valor as Coordenada).longitud); }
