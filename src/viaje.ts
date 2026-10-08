export type Rol = "PASAJERO" | "CHOFER";
export type EstadoViaje = "SOLICITADO" | "ASIGNADO" | "EN_CURSO" | "FINALIZADO";

export interface Coordenada {
  latitud: number;
  longitud: number;
}

export interface Estimacion {
  id: string;
  origen: Coordenada;
  destino: Coordenada;
  distanciaMetros: number;
  duracionSegundos: number;
  precioEstimado: number;
  moneda: "ARS";
  multiplicadorDemanda: number;
  creadaEn: string;
  vigenteHasta: string;
  proveedorRuta: string;
  polilinea?: string;
}

export interface Viaje {
  id: string;
  codigo: string;
  pasajero: string;
  chofer: string;
  origen: Coordenada;
  destino: Coordenada;
  precioEstimado: number;
  precioFinal?: number;
  moneda: "ARS";
  estado: EstadoViaje;
  distanciaMetros: number;
  duracionSegundos: number;
  solicitadoEn: string;
  iniciadoEn?: string;
  finalizadoEn?: string;
}

const TIEMPO_ESTIMADO_POR_KM_SEGUNDOS = 180;
const PRECIO_BASE_ARS = 1000;
const PRECIO_POR_KM_ARS = 600;
const PRECIO_POR_MINUTO_ARS = 120;

function validarCoordenada(coordenada: Coordenada): void {
  if (!Number.isFinite(coordenada.latitud) || coordenada.latitud < -90 || coordenada.latitud > 90) {
    throw new Error("La latitud debe estar entre -90 y 90.");
  }
  if (!Number.isFinite(coordenada.longitud) || coordenada.longitud < -180 || coordenada.longitud > 180) {
    throw new Error("La longitud debe estar entre -180 y 180.");
  }
}

export function distanciaEnMetros(origen: Coordenada, destino: Coordenada): number {
  validarCoordenada(origen);
  validarCoordenada(destino);
  const radioTierraMetros = 6_371_000;
  const aRad = (grados: number) => grados * Math.PI / 180;
  const deltaLatitud = aRad(destino.latitud - origen.latitud);
  const deltaLongitud = aRad(destino.longitud - origen.longitud);
  const latitudOrigen = aRad(origen.latitud);
  const latitudDestino = aRad(destino.latitud);
  const haversine = Math.sin(deltaLatitud / 2) ** 2
    + Math.cos(latitudOrigen) * Math.cos(latitudDestino) * Math.sin(deltaLongitud / 2) ** 2;
  return Math.round(radioTierraMetros * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)));
}

export function crearEstimacion(origen: Coordenada, destino: Coordenada, ahora = new Date()): Estimacion {
  const distanciaMetros = distanciaEnMetros(origen, destino);
  const duracionSegundos = Math.max(60, Math.round(distanciaMetros / 1000 * TIEMPO_ESTIMADO_POR_KM_SEGUNDOS));
  const precioEstimado = Math.round(PRECIO_BASE_ARS
    + (distanciaMetros / 1000) * PRECIO_POR_KM_ARS
    + (duracionSegundos / 60) * PRECIO_POR_MINUTO_ARS);
  const vigenteHasta = new Date(ahora.getTime() + 3 * 60_000);
  return {
    id: `estimacion-${ahora.getTime()}`,
    origen, destino, distanciaMetros, duracionSegundos, precioEstimado,
    moneda: "ARS", multiplicadorDemanda: 1, proveedorRuta: "HAVERSINE",
    creadaEn: ahora.toISOString(), vigenteHasta: vigenteHasta.toISOString()
  };
}

export async function crearEstimacionConRuta(
  origen: Coordenada,
  destino: Coordenada,
  calculadorRuta: import("./rutas").CalculadorRuta,
  ahora = new Date()
): Promise<Estimacion> {
  const ruta = await calculadorRuta.calcular(origen, destino);
  const duracionSegundos = Math.max(60, ruta.duracionSegundos);
  const precioEstimado = Math.round(PRECIO_BASE_ARS
    + (ruta.distanciaMetros / 1000) * PRECIO_POR_KM_ARS
    + (duracionSegundos / 60) * PRECIO_POR_MINUTO_ARS);
  const vigenteHasta = new Date(ahora.getTime() + 3 * 60_000);
  return {
    id: `estimacion-${ahora.getTime()}`, origen, destino,
    distanciaMetros: ruta.distanciaMetros, duracionSegundos, precioEstimado,
    moneda: "ARS", multiplicadorDemanda: 1, proveedorRuta: ruta.proveedor,
    polilinea: ruta.polilinea, creadaEn: ahora.toISOString(), vigenteHasta: vigenteHasta.toISOString()
  };
}

export class RepositorioViajesMemoria {
  private readonly viajes = new Map<string, Viaje>();

  guardar(viaje: Viaje): Viaje {
    this.viajes.set(viaje.id, structuredClone(viaje));
    return structuredClone(viaje);
  }

  obtener(id: string): Viaje | undefined {
    const viaje = this.viajes.get(id);
    return viaje ? structuredClone(viaje) : undefined;
  }

  listar(): Viaje[] {
    return [...this.viajes.values()].map((viaje) => structuredClone(viaje));
  }
}

export function ejecutarViajeDeDemo(
  rol: Rol,
  destino: Coordenada,
  repositorio: RepositorioViajesMemoria,
  ahora = new Date(),
  origen?: Coordenada
): { estimacion: Estimacion; viaje: Viaje } {
  const origenDelActor = origen ?? (rol === "PASAJERO"
    ? { latitud: -27.451, longitud: -58.986 }
    : { latitud: -27.462, longitud: -58.993 });
  const estimacion = crearEstimacion(origenDelActor, destino, ahora);
  const viaje: Viaje = {
    id: `viaje-${ahora.getTime()}`,
    codigo: `VIAJE-${ahora.getTime()}`,
    pasajero: rol === "PASAJERO" ? "pasajero-demo" : "pasajero-generico",
    chofer: rol === "CHOFER" ? "chofer-demo" : "chofer-generico",
    origen: estimacion.origen,
    destino: estimacion.destino,
    precioEstimado: estimacion.precioEstimado,
    moneda: "ARS",
    estado: "SOLICITADO",
    distanciaMetros: estimacion.distanciaMetros,
    duracionSegundos: estimacion.duracionSegundos,
    solicitadoEn: ahora.toISOString()
  };
  viaje.estado = "ASIGNADO";
  viaje.estado = "EN_CURSO";
  viaje.iniciadoEn = new Date(ahora.getTime() + 1_000).toISOString();
  viaje.estado = "FINALIZADO";
  viaje.finalizadoEn = new Date(ahora.getTime() + 2_000).toISOString();
  viaje.precioFinal = viaje.precioEstimado;
  repositorio.guardar(viaje);
  return { estimacion, viaje };
}

export async function ejecutarViajeDeDemoConRuta(
  rol: Rol,
  origen: Coordenada,
  destino: Coordenada,
  repositorio: RepositorioViajesMemoria,
  calculadorRuta: import("./rutas").CalculadorRuta,
  ahora = new Date()
): Promise<{ estimacion: Estimacion; viaje: Viaje }> {
  const estimacion = await crearEstimacionConRuta(origen, destino, calculadorRuta, ahora);
  const viaje: Viaje = {
    id: `viaje-${ahora.getTime()}`, codigo: `VIAJE-${ahora.getTime()}`,
    pasajero: rol === "PASAJERO" ? "pasajero-demo" : "pasajero-generico",
    chofer: rol === "CHOFER" ? "chofer-demo" : "chofer-generico",
    origen: estimacion.origen, destino: estimacion.destino,
    precioEstimado: estimacion.precioEstimado, moneda: "ARS", estado: "FINALIZADO",
    distanciaMetros: estimacion.distanciaMetros, duracionSegundos: estimacion.duracionSegundos,
    solicitadoEn: ahora.toISOString(), iniciadoEn: new Date(ahora.getTime() + 1_000).toISOString(),
    finalizadoEn: new Date(ahora.getTime() + 2_000).toISOString(), precioFinal: estimacion.precioEstimado
  };
  repositorio.guardar(viaje);
  return { estimacion, viaje };
}
