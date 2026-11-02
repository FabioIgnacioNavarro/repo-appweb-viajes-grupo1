import { distanceHaversineMetros } from "./utilidades";
import {
  ErrorTarifas,
  construirNivelesCascada,
  estaDentroDeCuadro,
  validarCoordenada,
  type CalculadorRuta,
  type Coordenada,
  type CuadroDelimitador,
  type FuenteClima,
  type FuenteDemanda,
  type FuenteDisponibilidad,
  type Geocodificador,
  type ObservacionClima,
  type OpcionesGeocodificacion,
  type RutaCalculada,
  type ZonaTarifaria
} from "./dominio";

export type { Geocodificador, OpcionesGeocodificacion, CuadroDelimitador };

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

export class GeocodificadorGoogle implements Geocodificador {
  private readonly cacheDirecta = new Map<string, Coordenada>();
  private readonly cacheInversa = new Map<string, string>();

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 1800,
    private readonly obtener: Obtener = fetch,
    private readonly radioNivel1Km = 25,
    private readonly radioNivel2Km = 250
  ) {
    if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY es obligatoria para Google Geocoding.");
  }

  private async consultarGoogle(parametros: URLSearchParams, operacion: string): Promise<{
    status?: string;
    results?: Array<{ formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } } }>;
  }> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${parametros}`;
    let respuesta: Response;
    try {
      respuesta = await this.obtener(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      registrarFalla("google_geocoding", operacion, "timeout_o_red");
      throw new ErrorTarifas("DEPENDENCIA_NO_DISPONIBLE", "Google Geocoding no respondió a tiempo.");
    }
    if (!respuesta.ok) {
      registrarFalla("google_geocoding", operacion, `http_${respuesta.status}`);
      throw new ErrorTarifas(
        respuesta.status >= 500 || respuesta.status === 429 ? "DEPENDENCIA_NO_DISPONIBLE" : "PROVEEDOR_GEO_RECHAZO",
        "Google Geocoding no pudo procesar la consulta."
      );
    }
    try {
      return await respuesta.json() as {
        status?: string;
        results?: Array<{ formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } } }>;
      };
    } catch {
      registrarFalla("google_geocoding", operacion, "json_invalido");
      throw new ErrorTarifas("RESPUESTA_DEPENDENCIA_INVALIDA", "Google Geocoding devolvió una respuesta inválida.");
    }
  }

  async geocodificar(direccion: string, opciones?: OpcionesGeocodificacion): Promise<Coordenada> {
    const texto = direccion.trim();
    if (!texto) throw new ErrorTarifas("DIRECCION_INVALIDA", "La dirección a geocodificar no puede estar vacía.");

    const claveCache = `${texto.toLowerCase()}|${opciones?.centro ? `${opciones.centro.latitud.toFixed(3)},${opciones.centro.longitud.toFixed(3)}` : "sin_centro"}`;
    const enCache = this.cacheDirecta.get(claveCache);
    if (enCache) return structuredClone(enCache);

    if (opciones?.centro) {
      const niveles = construirNivelesCascada(
        opciones.centro,
        opciones.radioNivel1Km ?? this.radioNivel1Km,
        opciones.radioNivel2Km ?? this.radioNivel2Km,
        "ar"
      );

      for (const nivel of niveles) {
        const parametros = new URLSearchParams({
          address: texto,
          key: this.apiKey,
          language: "es",
          region: nivel.codigoPais
        });
        if (nivel.cuadro) {
          parametros.set("bounds", `${nivel.cuadro.sur},${nivel.cuadro.oeste}|${nivel.cuadro.norte},${nivel.cuadro.este}`);
        }
        const cuerpo = await this.consultarGoogle(parametros, "geocodificar");
        if (cuerpo.status === "ZERO_RESULTS" || !cuerpo.results || cuerpo.results.length === 0) {
          continue;
        }
        if (cuerpo.status && cuerpo.status !== "OK") {
          registrarFalla("google_geocoding", "geocodificar", cuerpo.status);
          throw new ErrorTarifas("PROVEEDOR_GEO_RECHAZO", `Google Geocoding rechazó la consulta: ${cuerpo.status}.`);
        }
        for (const item of cuerpo.results) {
          const ubicacion = item.geometry?.location;
          if (typeof ubicacion?.lat === "number" && typeof ubicacion?.lng === "number" && Number.isFinite(ubicacion.lat) && Number.isFinite(ubicacion.lng)) {
            const coord: Coordenada = { latitud: ubicacion.lat, longitud: ubicacion.lng };
            if (!nivel.restringirCuadro || !nivel.cuadro || estaDentroDeCuadro(coord, nivel.cuadro)) {
              this.cacheDirecta.set(claveCache, coord);
              return structuredClone(coord);
            }
          }
        }
      }
      throw new ErrorTarifas("DIRECCION_NO_ENCONTRADA", `No se encontró la dirección: "${texto}".`);
    }

    const parametros = new URLSearchParams({
      address: texto,
      key: this.apiKey,
      language: "es",
      region: "ar"
    });
    const cuerpo = await this.consultarGoogle(parametros, "geocodificar");
    if (cuerpo.status === "ZERO_RESULTS" || !cuerpo.results || cuerpo.results.length === 0) {
      throw new ErrorTarifas("DIRECCION_NO_ENCONTRADA", `No se encontró la dirección: "${texto}".`);
    }
    if (cuerpo.status && cuerpo.status !== "OK") {
      registrarFalla("google_geocoding", "geocodificar", cuerpo.status);
      throw new ErrorTarifas("PROVEEDOR_GEO_RECHAZO", `Google Geocoding rechazó la consulta: ${cuerpo.status}.`);
    }
    const ubicacion = cuerpo.results[0]?.geometry?.location;
    if (typeof ubicacion?.lat !== "number" || typeof ubicacion?.lng !== "number" || !Number.isFinite(ubicacion.lat) || !Number.isFinite(ubicacion.lng)) {
      throw new ErrorTarifas("RESPUESTA_DEPENDENCIA_INVALIDA", "Google Geocoding no devolvió coordenadas válidas.");
    }
    const resultado = { latitud: ubicacion.lat, longitud: ubicacion.lng };
    this.cacheDirecta.set(claveCache, resultado);
    return structuredClone(resultado);
  }

  async geocodificarInversa(coordenada: Coordenada): Promise<string> {
    validarCoordenada(coordenada);
    const clave = `${coordenada.latitud.toFixed(5)},${coordenada.longitud.toFixed(5)}`;
    const cacheada = this.cacheInversa.get(clave);
    if (cacheada) return cacheada;

    const parametros = new URLSearchParams({
      latlng: `${coordenada.latitud},${coordenada.longitud}`,
      key: this.apiKey,
      language: "es",
      region: "ar"
    });
    const cuerpo = await this.consultarGoogle(parametros, "geocodificar_inversa");
    if (cuerpo.status === "ZERO_RESULTS" || !cuerpo.results || cuerpo.results.length === 0) {
      throw new ErrorTarifas("DIRECCION_NO_ENCONTRADA", "No se encontró una dirección para las coordenadas indicadas.");
    }
    if (cuerpo.status && cuerpo.status !== "OK") {
      registrarFalla("google_geocoding", "geocodificar_inversa", cuerpo.status);
      throw new ErrorTarifas("PROVEEDOR_GEO_RECHAZO", `Google Geocoding rechazó la consulta inversa: ${cuerpo.status}.`);
    }
    const direccion = cuerpo.results[0]?.formatted_address?.trim();
    if (!direccion) {
      throw new ErrorTarifas("RESPUESTA_DEPENDENCIA_INVALIDA", "Google Geocoding no devolvió una dirección formateada.");
    }
    this.cacheInversa.set(clave, direccion);
    return direccion;
  }
}

interface RespuestaInversaNominatim {
  display_name?: string;
  error?: string;
  address?: {
    road?: string;
    pedestrian?: string;
    house_number?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    amenity?: string;
    tourism?: string;
    shop?: string;
    building?: string;
  };
}

export class GeocodificadorNominatim implements Geocodificador {
  private readonly cacheDirecta = new Map<string, Coordenada>();
  private readonly cacheInversa = new Map<string, string>();

  constructor(
    private readonly userAgent = "viajes-grupo1-tp/1.0 (contacto@universidad.edu.ar)",
    private readonly timeoutMs = 2500,
    private readonly obtener: Obtener = fetch,
    private readonly radioNivel1Km = 25,
    private readonly radioNivel2Km = 250
  ) {}

  private async consultarBusqueda(parametros: URLSearchParams): Promise<Coordenada | undefined> {
    const url = `https://nominatim.openstreetmap.org/search?${parametros}`;
    let respuesta: Response;
    try {
      respuesta = await this.obtener(url, {
        headers: { "User-Agent": this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      registrarFalla("nominatim_osm", "geocodificar", "timeout_o_red");
      throw new ErrorTarifas("DEPENDENCIA_NO_DISPONIBLE", "El servicio de geocodificación de OpenStreetMap no respondió a tiempo.");
    }

    if (!respuesta.ok) {
      registrarFalla("nominatim_osm", "geocodificar", `http_${respuesta.status}`);
      throw new ErrorTarifas(
        respuesta.status >= 500 || respuesta.status === 429 ? "DEPENDENCIA_NO_DISPONIBLE" : "PROVEEDOR_GEO_RECHAZO",
        "El servicio de geocodificación de OpenStreetMap no pudo resolver la dirección."
      );
    }

    let resultados: Array<{ lat?: string; lon?: string }>;
    try {
      resultados = await respuesta.json() as typeof resultados;
    } catch {
      registrarFalla("nominatim_osm", "geocodificar", "json_invalido");
      throw new ErrorTarifas("RESPUESTA_DEPENDENCIA_INVALIDA", "El servicio de geocodificación devolvió una respuesta no válida.");
    }

    if (!Array.isArray(resultados) || resultados.length === 0) {
      return undefined;
    }

    const latitud = Number(resultados[0]?.lat);
    const longitud = Number(resultados[0]?.lon);
    if (!Number.isFinite(latitud) || !Number.isFinite(longitud) || latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) {
      throw new ErrorTarifas("RESPUESTA_DEPENDENCIA_INVALIDA", "El servicio de geocodificación devolvió coordenadas fuera de rango.");
    }

    return { latitud, longitud };
  }

  async geocodificar(direccion: string, opciones?: OpcionesGeocodificacion): Promise<Coordenada> {
    const texto = direccion.trim();
    if (!texto) throw new ErrorTarifas("DIRECCION_INVALIDA", "La dirección a geocodificar no puede estar vacía.");

    // Coordenadas explícitas numéricas: e.g. "-27.451, -58.986"
    const regexCoord = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/;
    const match = regexCoord.exec(texto);
    if (match) {
      const latitud = Number(match[1]);
      const longitud = Number(match[2]);
      if (Number.isFinite(latitud) && Number.isFinite(longitud) && latitud >= -90 && latitud <= 90 && longitud >= -180 && longitud <= 180) {
        return { latitud, longitud };
      }
    }

    const claveCache = `${texto.toLowerCase()}|${opciones?.centro ? `${opciones.centro.latitud.toFixed(3)},${opciones.centro.longitud.toFixed(3)}` : "sin_centro"}`;
    const enCache = this.cacheDirecta.get(claveCache);
    if (enCache) return structuredClone(enCache);

    if (opciones?.centro) {
      const niveles = construirNivelesCascada(
        opciones.centro,
        opciones.radioNivel1Km ?? this.radioNivel1Km,
        opciones.radioNivel2Km ?? this.radioNivel2Km,
        "ar"
      );

      for (const nivel of niveles) {
        const parametros = new URLSearchParams({
          q: texto,
          format: "json",
          limit: "1",
          countrycodes: nivel.codigoPais
        });
        if (nivel.cuadro) {
          parametros.set(
            "viewbox",
            `${nivel.cuadro.oeste.toFixed(6)},${nivel.cuadro.norte.toFixed(6)},${nivel.cuadro.este.toFixed(6)},${nivel.cuadro.sur.toFixed(6)}`
          );
        }
        if (nivel.restringirCuadro) {
          parametros.set("bounded", "1");
        }
        const encontrado = await this.consultarBusqueda(parametros);
        if (encontrado) {
          this.cacheDirecta.set(claveCache, encontrado);
          return structuredClone(encontrado);
        }
      }
      throw new ErrorTarifas("DIRECCION_NO_ENCONTRADA", `No se encontró la dirección: "${texto}".`);
    }

    const parametros = new URLSearchParams({
      q: texto,
      format: "json",
      limit: "1"
    });
    const encontrado = await this.consultarBusqueda(parametros);
    if (!encontrado) {
      throw new ErrorTarifas("DIRECCION_NO_ENCONTRADA", `No se encontró la dirección: "${texto}".`);
    }
    this.cacheDirecta.set(claveCache, encontrado);
    return structuredClone(encontrado);
  }

  async geocodificarInversa(coordenada: Coordenada): Promise<string> {
    validarCoordenada(coordenada);
    const clave = `${coordenada.latitud.toFixed(5)},${coordenada.longitud.toFixed(5)}`;
    const cacheada = this.cacheInversa.get(clave);
    if (cacheada) return cacheada;

    const parametros = new URLSearchParams({
      lat: String(coordenada.latitud),
      lon: String(coordenada.longitud),
      format: "json",
      zoom: "18",
      addressdetails: "1"
    });
    const url = `https://nominatim.openstreetmap.org/reverse?${parametros}`;

    let respuesta: Response;
    try {
      respuesta = await this.obtener(url, {
        headers: { "User-Agent": this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      registrarFalla("nominatim_osm", "geocodificar_inversa", "timeout_o_red");
      throw new ErrorTarifas("DEPENDENCIA_NO_DISPONIBLE", "El servicio de geocodificación inversa de OpenStreetMap no respondió a tiempo.");
    }

    if (!respuesta.ok) {
      registrarFalla("nominatim_osm", "geocodificar_inversa", `http_${respuesta.status}`);
      throw new ErrorTarifas(
        respuesta.status >= 500 || respuesta.status === 429 ? "DEPENDENCIA_NO_DISPONIBLE" : "PROVEEDOR_GEO_RECHAZO",
        "El servicio de geocodificación inversa no pudo resolver la ubicación."
      );
    }

    let cuerpo: RespuestaInversaNominatim;
    try {
      cuerpo = await respuesta.json() as RespuestaInversaNominatim;
    } catch {
      registrarFalla("nominatim_osm", "geocodificar_inversa", "json_invalido");
      throw new ErrorTarifas("RESPUESTA_DEPENDENCIA_INVALIDA", "El servicio de geocodificación inversa devolvió una respuesta inválida.");
    }

    if (cuerpo.error) {
      throw new ErrorTarifas("DIRECCION_NO_ENCONTRADA", "No se encontró una dirección para las coordenadas seleccionadas.");
    }

    const dir = cuerpo.address;
    if (dir) {
      const lugar = dir.amenity || dir.tourism || dir.shop || dir.building;
      const calleBase = dir.road || dir.pedestrian || dir.neighbourhood || dir.suburb;
      const calleConAltura = calleBase ? [calleBase, dir.house_number].filter(Boolean).join(" ") : undefined;
      const localidad = dir.city || dir.town || dir.village || dir.municipality || dir.state;
      const partes = [lugar, calleConAltura, localidad].filter(Boolean);
      if (partes.length > 0) {
        const formateada = partes.join(", ");
        this.cacheInversa.set(clave, formateada);
        return formateada;
      }
    }

    if (cuerpo.display_name) {
      const resumida = cuerpo.display_name
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(", ");
      if (resumida) {
        this.cacheInversa.set(clave, resumida);
        return resumida;
      }
    }

    throw new ErrorTarifas("DIRECCION_NO_ENCONTRADA", "No se encontró una dirección para las coordenadas seleccionadas.");
  }
}

interface SemillaGeografica {
  claves: string[];
  nombreVisible: string;
  coordenada: Coordenada;
}

export class GeocodificadorFalso implements Geocodificador {
  private readonly catalogo: SemillaGeografica[] = [
    {
      claves: ["plaza 25 de mayo", "plaza 25 de mayo, resistencia", "resistencia"],
      nombreVisible: "Plaza 25 de Mayo, Resistencia",
      coordenada: { latitud: -27.451, longitud: -58.986 }
    },
    {
      claves: ["terminal", "terminal de omnibus", "terminal de omnibus, resistencia"],
      nombreVisible: "Terminal de Ómnibus, Resistencia",
      coordenada: { latitud: -27.462, longitud: -58.993 }
    },
    {
      claves: ["aeropuerto", "aeropuerto resistencia", "aeropuerto internacional de resistencia"],
      nombreVisible: "Aeropuerto Internacional de Resistencia",
      coordenada: { latitud: -27.448, longitud: -59.056 }
    },
    {
      claves: ["casa de las culturas"],
      nombreVisible: "Casa de las Culturas, Resistencia",
      coordenada: { latitud: -27.452, longitud: -58.984 }
    },
    {
      claves: ["parque de la democracia"],
      nombreVisible: "Parque de la Democracia, Resistencia",
      coordenada: { latitud: -27.433, longitud: -58.966 }
    },
    {
      claves: ["shopping sarmiento", "sarmiento"],
      nombreVisible: "Shopping Sarmiento, Resistencia",
      coordenada: { latitud: -27.438, longitud: -58.972 }
    },
    {
      claves: ["facultad de ingenieria unne", "campus unne", "unne campus resistencia", "unne"],
      nombreVisible: "Campus UNNE, Resistencia",
      coordenada: { latitud: -27.466, longitud: -58.979 }
    },
    {
      claves: ["hospital perrando", "perrando"],
      nombreVisible: "Hospital Julio C. Perrando, Resistencia",
      coordenada: { latitud: -27.449, longitud: -58.976 }
    },
    {
      claves: ["av 9 de julio", "9 de julio", "av 9 de julio, resistencia"],
      nombreVisible: "Av. 9 de Julio, Resistencia",
      coordenada: { latitud: -27.452, longitud: -58.985 }
    },
    {
      claves: ["costanera corrientes", "corrientes", "plaza 25 de mayo, corrientes"],
      nombreVisible: "Costanera General San Martín, Corrientes",
      coordenada: { latitud: -27.465, longitud: -58.839 }
    },
    {
      claves: ["av 9 de julio", "9 de julio", "av 9 de julio, corrientes"],
      nombreVisible: "Av. 9 de Julio, Corrientes",
      coordenada: { latitud: -27.475, longitud: -58.825 }
    },
    {
      claves: ["saenz pena", "sáenz peña", "presidencia roque saenz pena", "av 9 de julio"],
      nombreVisible: "Centro, Presidencia Roque Sáenz Peña, Chaco",
      coordenada: { latitud: -26.785, longitud: -60.439 }
    },
    {
      claves: ["obelisco", "buenos aires", "av 9 de julio", "9 de julio"],
      nombreVisible: "Obelisco, Av. 9 de Julio, Buenos Aires",
      coordenada: { latitud: -34.6037, longitud: -58.3816 }
    }
  ];

  constructor(
    semillasPersonalizadas?: Record<string, Coordenada>,
    private readonly radioNivel1Km = 25,
    private readonly radioNivel2Km = 250
  ) {
    if (semillasPersonalizadas) {
      for (const [clave, coordenada] of Object.entries(semillasPersonalizadas)) {
        this.catalogo.unshift({
          claves: [clave.toLowerCase()],
          nombreVisible: clave,
          coordenada
        });
      }
    }
  }

  private buscarEnCandidatos(texto: string, candidatos: SemillaGeografica[]): Coordenada | undefined {
    // 1. Coincidencia exacta con alguna clave
    for (const item of candidatos) {
      if (item.claves.includes(texto)) {
        return structuredClone(item.coordenada);
      }
    }

    // 2. Coincidencia por subcadena, priorizando las claves más largas y específicas
    const pares: Array<{ clave: string; coordenada: Coordenada }> = [];
    for (const item of candidatos) {
      for (const clave of item.claves) {
        pares.push({ clave, coordenada: item.coordenada });
      }
    }
    pares.sort((a, b) => b.clave.length - a.clave.length);
    for (const par of pares) {
      if (texto.includes(par.clave)) {
        return structuredClone(par.coordenada);
      }
    }
    return undefined;
  }

  async geocodificar(direccion: string, opciones?: OpcionesGeocodificacion): Promise<Coordenada> {
    const texto = direccion.trim().toLowerCase();
    if (!texto) throw new ErrorTarifas("DIRECCION_INVALIDA", "La dirección no puede estar vacía.");

    // 1. Coordenadas explícitas numéricas
    const regexCoord = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/;
    const match = regexCoord.exec(texto);
    if (match) {
      const latitud = Number(match[1]);
      const longitud = Number(match[2]);
      if (Number.isFinite(latitud) && Number.isFinite(longitud) && latitud >= -90 && latitud <= 90 && longitud >= -180 && longitud <= 180) {
        return { latitud, longitud };
      }
    }

    // 2. Si se provee centro de proximidad, buscar en cascada (Nivel 1 -> Nivel 2 -> Nivel 3)
    if (opciones?.centro) {
      const niveles = construirNivelesCascada(
        opciones.centro,
        opciones.radioNivel1Km ?? this.radioNivel1Km,
        opciones.radioNivel2Km ?? this.radioNivel2Km,
        "ar"
      );

      for (const nivel of niveles) {
        const candidatosNivel = nivel.restringirCuadro && nivel.cuadro
          ? this.catalogo.filter((item) => estaDentroDeCuadro(item.coordenada, nivel.cuadro!))
          : this.catalogo;
        const encontrado = this.buscarEnCandidatos(texto, candidatosNivel);
        if (encontrado) return encontrado;
      }
      throw new ErrorTarifas("DIRECCION_NO_ENCONTRADA", `No se encontró la dirección de prueba: "${direccion}".`);
    }

    // 3. Búsqueda directa sin centro de proximidad
    const encontrado = this.buscarEnCandidatos(texto, this.catalogo);
    if (encontrado) return encontrado;

    throw new ErrorTarifas("DIRECCION_NO_ENCONTRADA", `No se encontró la dirección de prueba: "${direccion}".`);
  }

  async geocodificarInversa(coordenada: Coordenada): Promise<string> {
    validarCoordenada(coordenada);
    let mejorSemilla: SemillaGeografica | undefined;
    let menorDistancia = Number.POSITIVE_INFINITY;

    for (const item of this.catalogo) {
      const dist = distanceHaversineMetros(coordenada, item.coordenada);
      if (dist < menorDistancia) {
        menorDistancia = dist;
        mejorSemilla = item;
      }
    }

    if (mejorSemilla && menorDistancia <= 600) {
      return mejorSemilla.nombreVisible;
    }

    const centroResistencia: Coordenada = { latitud: -27.451, longitud: -58.986 };
    const distResistencia = distanceHaversineMetros(coordenada, centroResistencia);
    if (distResistencia <= 25_000) {
      return `Gran Resistencia (${coordenada.latitud.toFixed(4)}, ${coordenada.longitud.toFixed(4)})`;
    }
    if (distResistencia <= 250_000) {
      return `Región Chaco / Corrientes (${coordenada.latitud.toFixed(4)}, ${coordenada.longitud.toFixed(4)})`;
    }
    return `Argentina (${coordenada.latitud.toFixed(4)}, ${coordenada.longitud.toFixed(4)})`;
  }
}

export function crearGeocodificador(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = Number(env.TIMEOUT_PROVEEDOR_MS ?? 1800)
): Geocodificador {
  const proveedorGeo = env.GEOCODIFICADOR_PROVEEDOR?.toUpperCase();
  const proveedorRuta = (env.RUTA_PROVEEDOR ?? "OSRM").toUpperCase();
  const modo = env.PROVEEDORES_MODO?.toLowerCase();
  const radioNivel1Km = Number(env.GEO_RADIO_NIVEL1_KM ?? 25);
  const radioNivel2Km = Number(env.GEO_RADIO_NIVEL2_KM ?? 250);

  if (!Number.isFinite(radioNivel1Km) || radioNivel1Km <= 0 || !Number.isFinite(radioNivel2Km) || radioNivel2Km <= radioNivel1Km) {
    throw new Error("GEO_RADIO_NIVEL1_KM y GEO_RADIO_NIVEL2_KM deben ser números positivos con nivel 2 > nivel 1.");
  }

  // 1. Modo falso explícito para tests unitarios / offline
  if (modo === "falso" || proveedorGeo === "FALSO" || (proveedorRuta === "HAVERSINE" && !proveedorGeo)) {
    return new GeocodificadorFalso(undefined, radioNivel1Km, radioNivel2Km);
  }

  // 2. Google Maps si se especifica o si hay clave presente
  if ((proveedorGeo === "GOOGLE" || (!proveedorGeo && proveedorRuta === "GOOGLE")) && env.GOOGLE_MAPS_API_KEY) {
    return new GeocodificadorGoogle(env.GOOGLE_MAPS_API_KEY, timeoutMs, fetch, radioNivel1Km, radioNivel2Km);
  }

  // 3. Nominatim (OpenStreetMap) por defecto para resolución en vivo sin tarjetas
  if (proveedorGeo === "NOMINATIM" || !proveedorGeo || proveedorRuta === "OSRM") {
    return new GeocodificadorNominatim("viajes-grupo1-tp/1.0", timeoutMs, fetch, radioNivel1Km, radioNivel2Km);
  }

  return new GeocodificadorFalso(undefined, radioNivel1Km, radioNivel2Km);
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

/** Fuente determinista para Compose y E2E; no realiza llamadas a servicios públicos. */
export class FuenteClimaFalsa implements FuenteClima {
  async consultar(_zona: ZonaTarifaria): Promise<ObservacionClima> {
    return { precipitacionMm: 0, observadaEn: new Date(Date.now() - 1000), fuente: "FAKE" };
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
