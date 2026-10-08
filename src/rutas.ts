import type { Coordenada } from "./viaje";

export type ProveedorRuta = "GOOGLE" | "OSRM" | "HAVERSINE";

export interface RutaCalculada {
  distanciaMetros: number;
  duracionSegundos: number;
  proveedor: ProveedorRuta;
  polilinea?: string;
}

export interface CalculadorRuta {
  calcular(origen: Coordenada, destino: Coordenada): Promise<RutaCalculada>;
}

export class RutaHaversine implements CalculadorRuta {
  async calcular(origen: Coordenada, destino: Coordenada): Promise<RutaCalculada> {
    const { distanciaEnMetros } = await import("./viaje");
    const distanciaMetros = distanciaEnMetros(origen, destino);
    return { distanciaMetros, duracionSegundos: Math.max(60, Math.round(distanciaMetros / 1000 * 180)), proveedor: "HAVERSINE" };
  }
}

export class RutaOsrm implements CalculadorRuta {
  constructor(private readonly baseUrl = "https://router.project-osrm.org") {}

  async calcular(origen: Coordenada, destino: Coordenada): Promise<RutaCalculada> {
    const coordenadas = `${origen.longitud},${origen.latitud};${destino.longitud},${destino.latitud}`;
    const url = `${this.baseUrl.replace(/\/$/, "")}/route/v1/driving/${coordenadas}?overview=full&geometries=polyline6`;
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`OSRM respondió HTTP ${respuesta.status}.`);
    const cuerpo = await respuesta.json() as { code?: string; routes?: Array<{ distance: number; duration: number; geometry?: string }> };
    const ruta = cuerpo.routes?.[0];
    if (cuerpo.code !== "Ok" || !ruta) throw new Error("OSRM no encontró una ruta entre esos puntos.");
    return { distanciaMetros: Math.round(ruta.distance), duracionSegundos: Math.round(ruta.duration), proveedor: "OSRM", polilinea: ruta.geometry };
  }
}

export class RutaGoogle implements CalculadorRuta {
  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY es obligatoria para usar Google.");
  }

  async calcular(origen: Coordenada, destino: Coordenada): Promise<RutaCalculada> {
    const respuesta = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origen.latitud, longitude: origen.longitud } } },
        destination: { location: { latLng: { latitude: destino.latitud, longitude: destino.longitud } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE"
      })
    });
    if (!respuesta.ok) throw new Error(`Google Routes API respondió HTTP ${respuesta.status}.`);
    const cuerpo = await respuesta.json() as { routes?: Array<{ distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }> };
    const ruta = cuerpo.routes?.[0];
    const duracion = ruta?.duration?.match(/^(\d+(?:\.\d+)?)s$/);
    if (!ruta?.distanceMeters || !duracion) throw new Error("Google Routes API no devolvió una ruta válida.");
    return {
      distanciaMetros: ruta.distanceMeters,
      duracionSegundos: Math.round(Number(duracion[1])),
      proveedor: "GOOGLE",
      polilinea: ruta.polyline?.encodedPolyline
    };
  }
}

export function crearCalculadorRuta(env: NodeJS.ProcessEnv = process.env): CalculadorRuta {
  const proveedor = (env.RUTA_PROVEEDOR ?? "OSRM").toUpperCase() as ProveedorRuta;
  if (proveedor === "GOOGLE") return new RutaGoogle(env.GOOGLE_MAPS_API_KEY ?? "");
  if (proveedor === "OSRM") return new RutaOsrm(env.OSRM_BASE_URL ?? "https://router.project-osrm.org");
  if (proveedor === "HAVERSINE") return new RutaHaversine();
  throw new Error(`RUTA_PROVEEDOR inválido: ${proveedor}. Usá GOOGLE, OSRM o HAVERSINE.`);
}
