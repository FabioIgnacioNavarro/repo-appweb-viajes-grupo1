export interface Coordenada { latitud: number; longitud: number; }
export interface ZonaTarifaria {
  id: string;
  nombre: string;
  centro: Coordenada;
  radioMetros: number;
  zonaHoraria: string;
}
export type FranjaHoraria = "MADRUGADA" | "MANANA" | "SIESTA" | "TARDE" | "NOCHE";
export interface RutaCalculada {
  distanciaMetros: number;
  duracionSegundos: number;
  proveedor: "OSRM" | "GOOGLE" | "HAVERSINE";
  polilinea?: string;
}
export interface ObservacionClima {
  precipitacionMm: number;
  observadaEn: Date;
  fuente: string;
}
export interface FactorPorUmbral { hasta: number; multiplicadorEscalado: number; }
export interface ReglaTarifa {
  version: number;
  tarifaBasePesos: bigint;
  precioPorKilometroPesos: bigint;
  precioPorMinutoPesos: bigint;
  multiplicadorMinimoEscalado: number;
  multiplicadorMaximoEscalado: number;
  lluviaConPrecipitacionEscalado: number;
  lluviaSinPrecipitacionEscalado: number;
  disponibilidad: FactorPorUmbral[];
  demandaPorMil: FactorPorUmbral[];
  horario: Record<FranjaHoraria, number>;
}
export interface FactoresPrecio {
  choferesDisponibles: number;
  solicitudesActivas: number;
  precipitacionMm: number;
  llueve: boolean;
  fuenteClima: string;
  climaObservadoEn: Date;
  franjaHoraria: FranjaHoraria;
  factorLluviaEscalado: number;
  factorDisponibilidadEscalado: number;
  factorDemandaEscalado: number;
  factorHorarioEscalado: number;
  multiplicadorAplicadoEscalado: number;
}
export interface EstimacionTarifa {
  id: string;
  pasajeroId: string;
  origen: Coordenada;
  destino: Coordenada;
  zona: ZonaTarifaria;
  precioEstimado: bigint;
  moneda: "ARS";
  distanciaMetros: number;
  duracionSegundos: number;
  proveedorRuta: RutaCalculada["proveedor"];
  polilinea?: string;
  multiplicadorDemandaEscalado: number;
  factoresPrecio: FactoresPrecio;
  versionRegla: number;
  creadaEn: Date;
  vigenteHasta: Date;
}

export interface CalculadorRuta { calcular(origen: Coordenada, destino: Coordenada): Promise<RutaCalculada>; }
export interface FuenteClima { consultar(zona: ZonaTarifaria): Promise<ObservacionClima>; }
export interface FuenteDisponibilidad { contarDisponibles(zona: ZonaTarifaria, origen: Coordenada): Promise<number>; }
export interface FuenteDemanda { contarSolicitudesActivas(zona: ZonaTarifaria): Promise<number>; }
export interface RepositorioZonas { resolver(coordenada: Coordenada): Promise<ZonaTarifaria>; }
export interface RepositorioReglas { obtenerActiva(): Promise<ReglaTarifa>; }
export interface RepositorioEstimaciones {
  guardar(estimacion: EstimacionTarifa): Promise<void>;
  obtener(id: string): Promise<EstimacionTarifa | undefined>;
}
export interface GeneradorId { generar(): string; }

export class ErrorTarifas extends Error {
  constructor(public readonly codigo: string, mensaje: string) { super(mensaje); this.name = "ErrorTarifas"; }
}

const ESCALA_MULTIPLICADOR = 10_000n;
const VIGENCIA_MS = 3 * 60_000;
const EDAD_MAXIMA_CLIMA_MS = 15 * 60_000;

export function validarCoordenada(coordenada: Coordenada): void {
  if (!Number.isFinite(coordenada.latitud) || coordenada.latitud < -90 || coordenada.latitud > 90) throw new ErrorTarifas("COORDENADAS_INVALIDAS", "La latitud debe estar entre -90 y 90.");
  if (!Number.isFinite(coordenada.longitud) || coordenada.longitud < -180 || coordenada.longitud > 180) throw new ErrorTarifas("COORDENADAS_INVALIDAS", "La longitud debe estar entre -180 y 180.");
}

function exigirConteo(valor: number, nombre: string): void {
  if (!Number.isSafeInteger(valor) || valor < 0) throw new ErrorTarifas("FACTOR_INVALIDO", `El conteo de ${nombre} no es válido.`);
}

function seleccionarFactor(valor: number, umbrales: FactorPorUmbral[]): number {
  const ordenados = [...umbrales].sort((a, b) => a.hasta - b.hasta);
  return ordenados.find((umbral) => valor <= umbral.hasta)?.multiplicadorEscalado
    ?? ordenados.at(-1)?.multiplicadorEscalado
    ?? 10_000;
}

export function obtenerFranjaHoraria(fecha: Date, zonaHoraria: string): FranjaHoraria {
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: zonaHoraria, hour: "2-digit", hourCycle: "h23" }).formatToParts(fecha);
  const hora = Number(partes.find((parte) => parte.type === "hour")?.value);
  if (!Number.isInteger(hora) || hora < 0 || hora > 23) throw new ErrorTarifas("ZONA_HORARIA_INVALIDA", "No se pudo resolver la hora local de la zona.");
  if (hora < 6) return "MADRUGADA";
  if (hora < 12) return "MANANA";
  if (hora < 16) return "SIESTA";
  if (hora < 20) return "TARDE";
  return "NOCHE";
}

function combinarMultiplicadores(factores: number[], regla: ReglaTarifa): number {
  let total = ESCALA_MULTIPLICADOR;
  for (const factor of factores) {
    if (!Number.isSafeInteger(factor) || factor <= 0) throw new ErrorTarifas("REGLA_INVALIDA", "La regla contiene un multiplicador inválido.");
    total = (total * BigInt(factor) + ESCALA_MULTIPLICADOR / 2n) / ESCALA_MULTIPLICADOR;
  }
  const minimo = BigInt(regla.multiplicadorMinimoEscalado);
  const maximo = BigInt(regla.multiplicadorMaximoEscalado);
  if (minimo <= 0n || maximo < minimo) throw new ErrorTarifas("REGLA_INVALIDA", "Los límites del multiplicador no son válidos.");
  return Number(total < minimo ? minimo : total > maximo ? maximo : total);
}

export function calcularPrecioPesos(
  ruta: Pick<RutaCalculada, "distanciaMetros" | "duracionSegundos">,
  regla: ReglaTarifa,
  multiplicadorEscalado: number
): bigint {
  if (!Number.isSafeInteger(ruta.distanciaMetros) || ruta.distanciaMetros < 0 || !Number.isSafeInteger(ruta.duracionSegundos) || ruta.duracionSegundos < 0) {
    throw new ErrorTarifas("RUTA_INVALIDA", "La distancia o duración de la ruta no es válida.");
  }
  if (regla.tarifaBasePesos < 0n || regla.precioPorKilometroPesos < 0n || regla.precioPorMinutoPesos < 0n) {
    throw new ErrorTarifas("REGLA_INVALIDA", "La regla contiene importes negativos.");
  }
  // Mantiene exactos base, km y minutos; la división y el redondeo ocurren al final.
  const baseEscaladaPorTresMil = regla.tarifaBasePesos * 3000n
    + BigInt(ruta.distanciaMetros) * regla.precioPorKilometroPesos * 3n
    + BigInt(ruta.duracionSegundos) * regla.precioPorMinutoPesos * 50n;
  const denominador = 3000n * ESCALA_MULTIPLICADOR;
  return (baseEscaladaPorTresMil * BigInt(multiplicadorEscalado) + denominador / 2n) / denominador;
}

export class CrearEstimacion {
  constructor(
    private readonly rutas: CalculadorRuta,
    private readonly clima: FuenteClima,
    private readonly disponibilidad: FuenteDisponibilidad,
    private readonly demanda: FuenteDemanda,
    private readonly zonas: RepositorioZonas,
    private readonly reglas: RepositorioReglas,
    private readonly estimaciones: RepositorioEstimaciones,
    private readonly ids: GeneradorId
  ) {}

  async ejecutar(pasajeroId: string, origen: Coordenada, destino: Coordenada, ahora = new Date()): Promise<EstimacionTarifa> {
    if (!pasajeroId) throw new ErrorTarifas("ACTOR_INVALIDO", "Falta el identificador del pasajero autenticado.");
    validarCoordenada(origen);
    validarCoordenada(destino);
    const [zona, regla, ruta] = await Promise.all([
      this.zonas.resolver(origen), this.reglas.obtenerActiva(), this.rutas.calcular(origen, destino)
    ]);
    const [observacion, choferesDisponibles, solicitudesActivas] = await Promise.all([
      this.clima.consultar(zona),
      this.disponibilidad.contarDisponibles(zona, origen),
      this.demanda.contarSolicitudesActivas(zona)
    ]);
    exigirConteo(choferesDisponibles, "choferes disponibles");
    exigirConteo(solicitudesActivas, "solicitudes activas");
    if (!Number.isFinite(observacion.precipitacionMm) || observacion.precipitacionMm < 0
      || !(observacion.observadaEn instanceof Date) || !Number.isFinite(observacion.observadaEn.getTime())
      || observacion.observadaEn.getTime() > ahora.getTime()
      || ahora.getTime() - observacion.observadaEn.getTime() > EDAD_MAXIMA_CLIMA_MS) {
      throw new ErrorTarifas("CLIMA_DESACTUALIZADO", "No hay un dato de lluvia válido y reciente para la zona.");
    }

    const franjaHoraria = obtenerFranjaHoraria(ahora, zona.zonaHoraria);
    const factorLluviaEscalado = observacion.precipitacionMm > 0
      ? regla.lluviaConPrecipitacionEscalado : regla.lluviaSinPrecipitacionEscalado;
    const factorDisponibilidadEscalado = seleccionarFactor(choferesDisponibles, regla.disponibilidad);
    const solicitudesPorMil = Math.min(3000, Number(BigInt(solicitudesActivas) * 1000n / BigInt(Math.max(choferesDisponibles, 1))));
    const factorDemandaEscalado = seleccionarFactor(solicitudesPorMil, regla.demandaPorMil);
    const factorHorarioEscalado = regla.horario[franjaHoraria];
    const multiplicadorDemandaEscalado = combinarMultiplicadores([
      factorLluviaEscalado, factorDisponibilidadEscalado, factorDemandaEscalado, factorHorarioEscalado
    ], regla);
    const estimacion: EstimacionTarifa = {
      id: this.ids.generar(), pasajeroId, origen: structuredClone(origen), destino: structuredClone(destino), zona,
      precioEstimado: calcularPrecioPesos({ ...ruta, duracionSegundos: Math.max(60, ruta.duracionSegundos) }, regla, multiplicadorDemandaEscalado), moneda: "ARS",
      distanciaMetros: ruta.distanciaMetros, duracionSegundos: Math.max(60, ruta.duracionSegundos),
      proveedorRuta: ruta.proveedor, polilinea: ruta.polilinea, multiplicadorDemandaEscalado,
      factoresPrecio: {
        choferesDisponibles, solicitudesActivas, precipitacionMm: observacion.precipitacionMm,
        llueve: observacion.precipitacionMm > 0, fuenteClima: observacion.fuente,
        climaObservadoEn: new Date(observacion.observadaEn), franjaHoraria,
        factorLluviaEscalado, factorDisponibilidadEscalado, factorDemandaEscalado,
        factorHorarioEscalado, multiplicadorAplicadoEscalado: multiplicadorDemandaEscalado
      }, versionRegla: regla.version, creadaEn: new Date(ahora),
      vigenteHasta: new Date(ahora.getTime() + VIGENCIA_MS)
    };
    await this.estimaciones.guardar(estimacion);
    return structuredClone(estimacion);
  }
}

export class RepositorioEstimacionesMemoria implements RepositorioEstimaciones {
  private readonly datos = new Map<string, EstimacionTarifa>();
  async guardar(estimacion: EstimacionTarifa): Promise<void> { this.datos.set(estimacion.id, structuredClone(estimacion)); }
  async obtener(id: string): Promise<EstimacionTarifa | undefined> { const dato = this.datos.get(id); return dato ? structuredClone(dato) : undefined; }
}

export class GeneradorIdMemoria implements GeneradorId {
  private secuencia = 0;
  generar(): string { this.secuencia += 1; return `estimacion-${this.secuencia}`; }
}
