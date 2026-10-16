import { distanceHaversineMetros } from "./utilidades";
import { ErrorTarifas, type CalculadorRuta, type Coordenada, type FuenteClima, type FuenteDemanda, type FuenteDisponibilidad, type ObservacionClima, type RutaCalculada, type ZonaTarifaria } from "./dominio";

type Obtener = (url: string, opciones?: RequestInit) => Promise<Response>;
function registrarFalla(servicio: string, operacion: string, resultado: string): void {
  console.error(JSON.stringify({ evento: "dependencia_http_fallida", servicio, operacion, resultado }));
}

async function obtenerJsonConReintento<T>(
  obtener: Obtener,
  url: string,
  token: string | undefined,
  timeoutMs: number,
  reintentar: boolean | number,
  servicio = "proveedor_externo",
  operacion = "consulta"
): Promise<T> {
  const reintentos = typeof reintentar === "boolean" ? (reintentar ? 1 : 0) : reintentar;
  const intentos = reintentos + 1;
  for (let intento = 0; intento < intentos; intento += 1) {
    let respuesta: Response;
    try {
      respuesta = await obtener(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      if (intento + 1 < intentos) { await new Promise((resolver) => setTimeout(resolver, 100)); continue; }
      console.error(JSON.stringify({ evento: "dependencia_http_fallida", servicio, operacion, resultado: "timeout_o_red" }));
      throw new ErrorTarifas("DEPENDENCIA_NO_DISPONIBLE", "Una dependencia necesaria no respondió a tiempo.");
    }
    if (respuesta.ok) {
      try { return await respuesta.json() as T; }
      catch { registrarFalla(servicio, operacion, "json_invalido"); throw new ErrorTarifas("RESPUESTA_DEPENDENCIA_INVALIDA", "Una dependencia respondió con datos inválidos."); }
    }
    const puedeReintentar = [429, 502, 503, 504].includes(respuesta.status);
    if (puedeReintentar && intento + 1 < intentos) { await new Promise((resolver) => setTimeout(resolver, 100)); continue; }
    if (puedeReintentar || respuesta.status >= 500) { console.error(JSON.stringify({ evento: "dependencia_http_fallida", servicio, operacion, resultado: `http_${respuesta.status}` })); throw new ErrorTarifas("DEPENDENCIA_NO_DISPONIBLE", "Una dependencia necesaria no está disponible."); }
    console.error(JSON.stringify({ evento: "dependencia_http_fallida", servicio, operacion, resultado: `rechazo_${respuesta.status}` }));
    throw new ErrorTarifas("DEPENDENCIA_RECHAZO_PEDIDO", "Una dependencia rechazó la consulta.");
  }
  throw new ErrorTarifas("DEPENDENCIA_NO_DISPONIBLE", "Una dependencia necesaria no está disponible.");
}

export class RutaOsrm implements CalculadorRuta {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 1800, private readonly obtener: Obtener = fetch) {
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) throw new Error("OSRM_BASE_URL debe ser una URL HTTP(S).");
  }
  async calcular(origen: Coordenada, destino: Coordenada): Promise<RutaCalculada> {
    const coordenadas = `${origen.longitud},${origen.latitud};${destino.longitud},${destino.latitud}`;
    const url = `${this.baseUrl.replace(/\/$/, "")}/route/v1/driving/${coordenadas}?overview=full&geometries=polyline6`;
    const cuerpo = await obtenerJsonConReintento<{ code?: string; routes?: Array<{ distance: number; duration: number; geometry?: string }> }>(this.obtener, url, undefined, this.timeoutMs, true);
    const ruta = cuerpo.routes?.[0];
    if (cuerpo.code !== "Ok" || !ruta || !Number.isFinite(ruta.distance) || !Number.isFinite(ruta.duration)) throw new ErrorTarifas("RUTA_NO_ENCONTRADA", "El proveedor no encontró un recorrido válido.");
    return { distanciaMetros: Math.round(ruta.distance), duracionSegundos: Math.round(ruta.duration), proveedor: "OSRM", polilinea: ruta.geometry };
  }
}

export class RutaGoogle implements CalculadorRuta {
  constructor(private readonly apiKey: string, private readonly timeoutMs = 1800, private readonly obtener: Obtener = fetch) {
    if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY es obligatoria para Google Routes.");
  }
  async calcular(origen: Coordenada, destino: Coordenada): Promise<RutaCalculada> {
    let respuesta: Response;
    try {
      respuesta = await this.obtener("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline" },
        body: JSON.stringify({ origin: { location: { latLng: { latitude: origen.latitud, longitude: origen.longitud } } }, destination: { location: { latLng: { latitude: destino.latitud, longitude: destino.longitud } } }, travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE" }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch { registrarFalla("google_routes", "calcular_ruta", "timeout_o_red"); throw new ErrorTarifas("DEPENDENCIA_NO_DISPONIBLE", "Google Routes no respondió a tiempo."); }
    if (!respuesta.ok) { registrarFalla("google_routes", "calcular_ruta", `http_${respuesta.status}`); throw new ErrorTarifas(respuesta.status >= 500 || respuesta.status === 429 ? "DEPENDENCIA_NO_DISPONIBLE" : "PROVEEDOR_RUTA_RECHAZO", "Google Routes no pudo calcular el recorrido."); }
    let cuerpo: { routes?: Array<{ distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }> };
    try { cuerpo = await respuesta.json() as typeof cuerpo; }
    catch { registrarFalla("google_routes", "calcular_ruta", "json_invalido"); throw new ErrorTarifas("RESPUESTA_DEPENDENCIA_INVALIDA", "Google Routes devolvió una respuesta inválida."); }
    const ruta = cuerpo.routes?.[0];
    const duracion = ruta?.duration?.match(/^(\d+(?:\.\d+)?)s$/);
    if (!ruta?.distanceMeters || !duracion) throw new ErrorTarifas("RUTA_NO_ENCONTRADA", "Google Routes no encontró un recorrido válido.");
    return { distanciaMetros: ruta.distanceMeters, duracionSegundos: Math.round(Number(duracion[1])), proveedor: "GOOGLE", polilinea: ruta.polyline?.encodedPolyline };
  }
}

export class RutaHaversine implements CalculadorRuta {
  async calcular(origen: Coordenada, destino: Coordenada): Promise<RutaCalculada> {
    const distanciaMetros = distanceHaversineMetros(origen, destino);
    return { distanciaMetros, duracionSegundos: Math.max(60, Math.round(distanciaMetros / 1000 * 180)), proveedor: "HAVERSINE" };
  }
}

export function crearCalculadorRuta(env: NodeJS.ProcessEnv = process.env, timeoutMs = Number(env.TIMEOUT_PROVEEDOR_MS ?? 1800)): CalculadorRuta {
  const proveedor = (env.RUTA_PROVEEDOR ?? "OSRM").toUpperCase();
  if (proveedor === "OSRM") return new RutaOsrm(env.OSRM_BASE_URL ?? "http://osrm:5000", timeoutMs);
  if (proveedor === "GOOGLE") return new RutaGoogle(env.GOOGLE_MAPS_API_KEY ?? "", timeoutMs);
  if (proveedor === "HAVERSINE") return new RutaHaversine();
  throw new Error("RUTA_PROVEEDOR debe ser OSRM, GOOGLE o HAVERSINE.");
}

export class FuenteClimaOpenMeteo implements FuenteClima {
  private readonly cache = new Map<string, { expiraEn: number; observacion: ObservacionClima }>();
  constructor(private readonly timeoutMs = 1800, private readonly obtener: Obtener = fetch, private readonly ahora: () => number = Date.now) {}
  async consultar(zona: ZonaTarifaria): Promise<ObservacionClima> {
    const cacheada = this.cache.get(zona.id);
    if (cacheada && cacheada.expiraEn > this.ahora()) return structuredClone(cacheada.observacion);
    const parametros = new URLSearchParams({ latitude: String(zona.centro.latitud), longitude: String(zona.centro.longitud), current: "precipitation", timezone: "UTC" });
    const cuerpo = await obtenerJsonConReintento<{ current?: { time?: string; precipitation?: number } }>(this.obtener, `https://api.open-meteo.com/v1/forecast?${parametros}`, undefined, this.timeoutMs, true);
    const fecha = cuerpo.current?.time ? new Date(`${cuerpo.current.time}Z`) : undefined;
    const precipitacion = cuerpo.current?.precipitation;
    if (!fecha || !Number.isFinite(fecha.getTime()) || typeof precipitacion !== "number" || !Number.isFinite(precipitacion)) throw new ErrorTarifas("RESPUESTA_CLIMA_INVALIDA", "El proveedor de clima devolvió datos inválidos.");
    const observacion = { precipitacionMm: precipitacion, observadaEn: fecha, fuente: "OPEN_METEO" };
    this.cache.set(zona.id, { expiraEn: this.ahora() + 15 * 60_000, observacion });
    return structuredClone(observacion);
  }
}

export class FuenteFlotaHttp implements FuenteDisponibilidad {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly timeoutMs = 1500, private readonly obtener: Obtener = fetch, private readonly reintentos = 1) {}
  async contarDisponibles(zona: ZonaTarifaria, origen: Coordenada): Promise<number> {
    const parametros = new URLSearchParams({ latitud: String(origen.latitud), longitud: String(origen.longitud), radio_metros: String(zona.radioMetros) });
    const cuerpo = await obtenerJsonConReintento<{ candidatos?: unknown[] }>(this.obtener, `${this.baseUrl.replace(/\/$/, "")}/choferes/cercanos?${parametros}`, this.token, this.timeoutMs, this.reintentos, "ms-flota", "buscar_candidatos");
    if (!Array.isArray(cuerpo.candidatos)) throw new ErrorTarifas("RESPUESTA_FLOTA_INVALIDA", "Flota devolvió una respuesta inválida.");
    return cuerpo.candidatos.length;
  }
}

export class FuenteDemandaHttp implements FuenteDemanda {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly timeoutMs = 1500, private readonly obtener: Obtener = fetch, private readonly reintentos = 1) {}
  async contarSolicitudesActivas(zona: ZonaTarifaria): Promise<number> {
    const parametros = new URLSearchParams({ zona_id: zona.id });
    const cuerpo = await obtenerJsonConReintento<{ solicitudes_activas?: unknown }>(this.obtener, `${this.baseUrl.replace(/\/$/, "")}/interno/demanda-por-zona?${parametros}`, this.token, this.timeoutMs, this.reintentos, "ms-viajes", "consultar_demanda");
    if (!Number.isSafeInteger(cuerpo.solicitudes_activas) || (cuerpo.solicitudes_activas as number) < 0) throw new ErrorTarifas("RESPUESTA_VIAJES_INVALIDA", "Viajes devolvió una respuesta inválida.");
    return cuerpo.solicitudes_activas as number;
  }
}
