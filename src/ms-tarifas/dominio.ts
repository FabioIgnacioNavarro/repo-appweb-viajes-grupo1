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
  autorId?: string;
  creadaEn?: Date;
  activa?: boolean;
}
export interface NuevaReglaDemandaInput {
  multiplicadorMinimoEscalado: number;
  multiplicadorMaximoEscalado: number;
  lluviaConPrecipitacionEscalado: number;
  lluviaSinPrecipitacionEscalado: number;
  disponibilidad: FactorPorUmbral[];
  demandaPorMil: FactorPorUmbral[];
  horario: Record<FranjaHoraria, number>;
}
export interface ReglaSnapshot {
  activa: ReglaTarifa;
  historial: ReglaTarifa[];
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
  recomendaciones?: string[];
  versionRegla: number;
  creadaEn: Date;
  vigenteHasta: Date;
}

export interface CalculadorRuta { calcular(origen: Coordenada, destino: Coordenada): Promise<RutaCalculada>; }
export interface CuadroDelimitador {
  sur: number;
  norte: number;
  oeste: number;
  este: number;
}
export interface OpcionesGeocodificacion {
  centro?: Coordenada;
  radioNivel1Km?: number;
  radioNivel2Km?: number;
}
export interface NivelBusquedaGeografica {
  nombre: "LOCAL" | "REGIONAL" | "NACIONAL";
  cuadro?: CuadroDelimitador;
  restringirCuadro: boolean;
  codigoPais: string;
}
export interface Geocodificador {
  geocodificar(direccion: string, opciones?: OpcionesGeocodificacion): Promise<Coordenada>;
  geocodificarInversa?(coordenada: Coordenada): Promise<string>;
}
export type PuntoUbicacion = Coordenada | { direccion: string };
export interface FuenteClima { consultar(zona: ZonaTarifaria): Promise<ObservacionClima>; }
export interface FuenteDisponibilidad { contarDisponibles(zona: ZonaTarifaria, origen: Coordenada): Promise<number>; }
export interface FuenteDemanda { contarSolicitudesActivas(zona: ZonaTarifaria): Promise<number>; }
export interface RepositorioZonas { resolver(coordenada: Coordenada): Promise<ZonaTarifaria>; }
export interface RepositorioReglas { obtenerActiva(): Promise<ReglaTarifa>; }
export interface RepositorioVersionesRegla extends RepositorioReglas {
  listarHistorial(): Promise<ReglaTarifa[]>;
  crearNuevaVersion(datos: Omit<ReglaTarifa, "version" | "activa">): Promise<ReglaTarifa>;
}
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

export function calcularCuadroDelimitador(centro: Coordenada, radioKm: number): CuadroDelimitador {
  validarCoordenada(centro);
  if (!Number.isFinite(radioKm) || radioKm <= 0) {
    throw new ErrorTarifas("RADIO_INVALIDO", "El radio de búsqueda debe ser un número positivo.");
  }
  const deltaLat = radioKm / 111.32;
  const factorLon = Math.max(0.1, Math.cos((centro.latitud * Math.PI) / 180));
  const deltaLon = radioKm / (111.32 * factorLon);
  return {
    sur: Math.max(-90, centro.latitud - deltaLat),
    norte: Math.min(90, centro.latitud + deltaLat),
    oeste: Math.max(-180, centro.longitud - deltaLon),
    este: Math.min(180, centro.longitud + deltaLon)
  };
}

export function estaDentroDeCuadro(coordenada: Coordenada, cuadro: CuadroDelimitador): boolean {
  return (
    coordenada.latitud >= cuadro.sur &&
    coordenada.latitud <= cuadro.norte &&
    coordenada.longitud >= cuadro.oeste &&
    coordenada.longitud <= cuadro.este
  );
}

export function construirNivelesCascada(
  centro: Coordenada,
  radioNivel1Km = 25,
  radioNivel2Km = 250,
  codigoPais = "ar"
): NivelBusquedaGeografica[] {
  return [
    {
      nombre: "LOCAL",
      cuadro: calcularCuadroDelimitador(centro, radioNivel1Km),
      restringirCuadro: true,
      codigoPais
    },
    {
      nombre: "REGIONAL",
      cuadro: calcularCuadroDelimitador(centro, radioNivel2Km),
      restringirCuadro: true,
      codigoPais
    },
    {
      nombre: "NACIONAL",
      restringirCuadro: false,
      codigoPais
    }
  ];
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

export function franjaParaHora(hora: number): FranjaHoraria {
  if (!Number.isInteger(hora) || hora < 0 || hora > 23) throw new ErrorTarifas("ZONA_HORARIA_INVALIDA", "No se pudo resolver la hora local de la zona.");
  if (hora < 6) return "MADRUGADA";
  if (hora < 12) return "MANANA";
  if (hora < 16) return "SIESTA";
  if (hora < 20) return "TARDE";
  return "NOCHE";
}

export function obtenerFranjaHoraria(fecha: Date, zonaHoraria: string): FranjaHoraria {
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: zonaHoraria, hour: "2-digit", hourCycle: "h23" }).formatToParts(fecha);
  const hora = Number(partes.find((parte) => parte.type === "hour")?.value);
  return franjaParaHora(hora);
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

export interface SimulacionTarifaInput {
  hora?: number; // 0 a 23
  franjaHoraria?: FranjaHoraria;
  llueve?: boolean;
  precipitacionMm?: number;
  choferesDisponibles?: number;
  solicitudesActivas?: number;
}

export function generarRecomendacionesTarifa(
  factores: FactoresPrecio,
  regla: ReglaTarifa
): string[] {
  const recomendaciones: string[] = [];

  // Recomendación horaria
  const factorHorarioActual = factores.factorHorarioEscalado;
  let franjaMasBarata: FranjaHoraria = factores.franjaHoraria;
  let menorFactor = factorHorarioActual;

  for (const [franja, factor] of Object.entries(regla.horario) as [FranjaHoraria, number][]) {
    if (factor < menorFactor) {
      menorFactor = factor;
      franjaMasBarata = franja;
    }
  }

  if (menorFactor < factorHorarioActual) {
    const ahorroPorc = Math.round(((factorHorarioActual - menorFactor) / factorHorarioActual) * 100);
    recomendaciones.push(
      `Viajar en franja ${franjaMasBarata} reduce el factor horario hasta un ${ahorroPorc}% respecto a ${factores.franjaHoraria}.`
    );
  }

  // Recomendación por lluvia
  if (factores.llueve) {
    const recargoLluviaPorc = Math.round(
      ((regla.lluviaConPrecipitacionEscalado - regla.lluviaSinPrecipitacionEscalado) / regla.lluviaSinPrecipitacionEscalado) * 100
    );
    recomendaciones.push(
      `Hay lluvia activa (${factores.precipitacionMm.toFixed(1)} mm) aplicando un recargo del ${recargoLluviaPorc}%. Si no tenés urgencia, esperar a que cese reducirá la tarifa.`
    );
  }

  // Recomendación por demanda
  if (factores.solicitudesActivas > factores.choferesDisponibles * 1.5) {
    recomendaciones.push(
      "Alta concentración de solicitudes en la zona. La demanda se normaliza habitualmente en 10-15 minutos."
    );
  }

  if (recomendaciones.length === 0) {
    recomendaciones.push("Tarifa en condiciones óptimas: franja horaria estándar y demanda equilibrada.");
  }

  return recomendaciones;
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
    private readonly ids: GeneradorId,
    private readonly geocodificador?: Geocodificador
  ) {}

  private async resolverPunto(punto: PuntoUbicacion, centroReferencia?: Coordenada): Promise<Coordenada> {
    if ("latitud" in punto && "longitud" in punto && typeof punto.latitud === "number" && typeof punto.longitud === "number") {
      validarCoordenada(punto);
      return punto;
    }
    if ("direccion" in punto && typeof punto.direccion === "string") {
      if (!this.geocodificador) {
        throw new ErrorTarifas("GEOCODIFICADOR_NO_CONFIGURADO", "No se configuró un geocodificador para resolver direcciones en texto.");
      }
      const coord = await this.geocodificador.geocodificar(
        punto.direccion,
        centroReferencia ? { centro: centroReferencia } : undefined
      );
      validarCoordenada(coord);
      return coord;
    }
    throw new ErrorTarifas("COORDENADAS_INVALIDAS", "El punto de ubicación no es válido.");
  }

  async ejecutar(
    pasajeroId: string,
    origenPunto: PuntoUbicacion,
    destinoPunto: PuntoUbicacion,
    ahora = new Date(),
    simulacion?: SimulacionTarifaInput
  ): Promise<EstimacionTarifa> {
    if (!pasajeroId) throw new ErrorTarifas("ACTOR_INVALIDO", "Falta el identificador del pasajero autenticado.");
    const origen = await this.resolverPunto(origenPunto);
    const destino = await this.resolverPunto(destinoPunto, origen);
    const [zona, regla, ruta] = await Promise.all([
      this.zonas.resolver(origen), this.reglas.obtenerActiva(), this.rutas.calcular(origen, destino)
    ]);

    if (simulacion?.hora !== undefined) {
      if (!Number.isInteger(simulacion.hora) || simulacion.hora < 0 || simulacion.hora > 23) {
        throw new ErrorTarifas("ENTRADA_INVALIDA", "La hora simulada debe ser un entero entre 0 y 23.");
      }
    }

    const promesas: [Promise<ObservacionClima>, Promise<number>, Promise<number>] = [
      simulacion?.precipitacionMm !== undefined || simulacion?.llueve !== undefined
        ? Promise.resolve({
            precipitacionMm: simulacion.precipitacionMm ?? (simulacion.llueve ? 5 : 0),
            observadaEn: ahora,
            fuente: "simulada_modo_dev",
          })
        : this.clima.consultar(zona),
      simulacion?.choferesDisponibles !== undefined
        ? Promise.resolve(Math.max(0, simulacion.choferesDisponibles))
        : this.disponibilidad.contarDisponibles(zona, origen),
      simulacion?.solicitudesActivas !== undefined
        ? Promise.resolve(Math.max(0, simulacion.solicitudesActivas))
        : this.demanda.contarSolicitudesActivas(zona),
    ];

    const [observacion, choferesDisponibles, solicitudesActivas] = await Promise.all(promesas);

    exigirConteo(choferesDisponibles, "choferes disponibles");
    exigirConteo(solicitudesActivas, "solicitudes activas");

    if (
      !Number.isFinite(observacion.precipitacionMm) ||
      observacion.precipitacionMm < 0 ||
      !(observacion.observadaEn instanceof Date) ||
      !Number.isFinite(observacion.observadaEn.getTime()) ||
      (!simulacion && (observacion.observadaEn.getTime() > ahora.getTime() || ahora.getTime() - observacion.observadaEn.getTime() > EDAD_MAXIMA_CLIMA_MS))
    ) {
      throw new ErrorTarifas("CLIMA_DESACTUALIZADO", "No hay un dato de lluvia válido y reciente para la zona.");
    }

    const franjaHoraria = simulacion?.franjaHoraria && FRANJAS_VALIDAS.includes(simulacion.franjaHoraria)
      ? simulacion.franjaHoraria
      : simulacion?.hora !== undefined
        ? franjaParaHora(simulacion.hora)
        : obtenerFranjaHoraria(ahora, zona.zonaHoraria);

    const factorLluviaEscalado = observacion.precipitacionMm > 0
      ? regla.lluviaConPrecipitacionEscalado : regla.lluviaSinPrecipitacionEscalado;
    const factorDisponibilidadEscalado = seleccionarFactor(choferesDisponibles, regla.disponibilidad);
    const solicitudesPorMil = Math.min(3000, Number(BigInt(solicitudesActivas) * 1000n / BigInt(Math.max(choferesDisponibles, 1))));
    const factorDemandaEscalado = seleccionarFactor(solicitudesPorMil, regla.demandaPorMil);
    const factorHorarioEscalado = regla.horario[franjaHoraria];
    const multiplicadorDemandaEscalado = combinarMultiplicadores([
      factorLluviaEscalado, factorDisponibilidadEscalado, factorDemandaEscalado, factorHorarioEscalado
    ], regla);

    const factoresPrecio: FactoresPrecio = {
      choferesDisponibles,
      solicitudesActivas,
      precipitacionMm: observacion.precipitacionMm,
      llueve: observacion.precipitacionMm > 0,
      fuenteClima: observacion.fuente,
      climaObservadoEn: new Date(observacion.observadaEn),
      franjaHoraria,
      factorLluviaEscalado,
      factorDisponibilidadEscalado,
      factorDemandaEscalado,
      factorHorarioEscalado,
      multiplicadorAplicadoEscalado: multiplicadorDemandaEscalado,
    };

    const recomendaciones = generarRecomendacionesTarifa(factoresPrecio, regla);

    const estimacion: EstimacionTarifa = {
      id: this.ids.generar(),
      pasajeroId,
      origen: structuredClone(origen),
      destino: structuredClone(destino),
      zona,
      precioEstimado: calcularPrecioPesos(
        { ...ruta, duracionSegundos: Math.max(60, ruta.duracionSegundos) },
        regla,
        multiplicadorDemandaEscalado
      ),
      moneda: "ARS",
      distanciaMetros: ruta.distanciaMetros,
      duracionSegundos: Math.max(60, ruta.duracionSegundos),
      proveedorRuta: ruta.proveedor,
      polilinea: ruta.polilinea,
      multiplicadorDemandaEscalado,
      factoresPrecio,
      recomendaciones,
      versionRegla: regla.version,
      creadaEn: new Date(ahora),
      vigenteHasta: new Date(ahora.getTime() + VIGENCIA_MS),
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

const MIN_FACTOR_ESCALADO = 5_000;
const MAX_FACTOR_ESCALADO = 50_000;
const FRANJAS_VALIDAS: readonly FranjaHoraria[] = ["MADRUGADA", "MANANA", "SIESTA", "TARDE", "NOCHE"];

function validarMultiplicadorEscalado(valor: number, campo: string): void {
  if (!Number.isSafeInteger(valor) || valor < MIN_FACTOR_ESCALADO || valor > MAX_FACTOR_ESCALADO) {
    throw new ErrorTarifas("REGLA_INVALIDA", `El multiplicador de ${campo} debe estar entre 0.50 y 5.00.`);
  }
}

function validarCurvaUmbrales(
  umbrales: FactorPorUmbral[],
  nombre: string,
  monotonia: "no_decreciente" | "no_creciente"
): FactorPorUmbral[] {
  if (!Array.isArray(umbrales) || umbrales.length === 0 || umbrales.length > 20) {
    throw new ErrorTarifas("REGLA_INVALIDA", `La curva de ${nombre} debe tener entre 1 y 20 tramos.`);
  }
  const copia: FactorPorUmbral[] = umbrales.map((tramo) => ({
    hasta: tramo.hasta,
    multiplicadorEscalado: tramo.multiplicadorEscalado
  }));
  for (let i = 0; i < copia.length; i++) {
    const actual = copia[i]!;
    if (!Number.isSafeInteger(actual.hasta) || actual.hasta < 0) {
      throw new ErrorTarifas("REGLA_INVALIDA", `El umbral de ${nombre} en el tramo ${i + 1} no es válido.`);
    }
    validarMultiplicadorEscalado(actual.multiplicadorEscalado, `${nombre} (tramo ${i + 1})`);
    if (i > 0) {
      const anterior = copia[i - 1]!;
      if (actual.hasta <= anterior.hasta) {
        throw new ErrorTarifas("REGLA_INVALIDA", `Los umbrales de ${nombre} deben crecer de forma estricta.`);
      }
      if (monotonia === "no_decreciente" && actual.multiplicadorEscalado < anterior.multiplicadorEscalado) {
        throw new ErrorTarifas("REGLA_INVALIDA", `La curva de ${nombre} no puede disminuir al aumentar la presión de demanda.`);
      }
      if (monotonia === "no_creciente" && actual.multiplicadorEscalado > anterior.multiplicadorEscalado) {
        throw new ErrorTarifas("REGLA_INVALIDA", `La curva de ${nombre} no puede aumentar cuando hay más choferes disponibles.`);
      }
    }
  }
  if (copia.at(-1)!.hasta !== Number.MAX_SAFE_INTEGER) {
    throw new ErrorTarifas("REGLA_INVALIDA", `El último tramo de ${nombre} debe cubrir el rango abierto superior.`);
  }
  return copia;
}

/** Valida invariantes de la regla dinámica editable (límites, curvas monótonas, lluvia y franjas). */
export function validarReglaDemandaInput(entrada: NuevaReglaDemandaInput): NuevaReglaDemandaInput {
  validarMultiplicadorEscalado(entrada.multiplicadorMinimoEscalado, "multiplicador mínimo");
  validarMultiplicadorEscalado(entrada.multiplicadorMaximoEscalado, "multiplicador máximo");
  if (entrada.multiplicadorMinimoEscalado > entrada.multiplicadorMaximoEscalado) {
    throw new ErrorTarifas("REGLA_INVALIDA", "El multiplicador mínimo no puede superar al máximo.");
  }
  validarMultiplicadorEscalado(entrada.lluviaConPrecipitacionEscalado, "lluvia con precipitación");
  validarMultiplicadorEscalado(entrada.lluviaSinPrecipitacionEscalado, "lluvia sin precipitación");
  if (entrada.lluviaConPrecipitacionEscalado < entrada.lluviaSinPrecipitacionEscalado) {
    throw new ErrorTarifas("REGLA_INVALIDA", "El multiplicador con lluvia debe ser mayor o igual que sin lluvia.");
  }
  const disponibilidad = validarCurvaUmbrales(entrada.disponibilidad, "disponibilidad", "no_creciente");
  const demandaPorMil = validarCurvaUmbrales(entrada.demandaPorMil, "demanda", "no_decreciente");
  const horario = {} as Record<FranjaHoraria, number>;
  for (const franja of FRANJAS_VALIDAS) {
    const valor = entrada.horario?.[franja];
    validarMultiplicadorEscalado(valor, `horario ${franja}`);
    horario[franja] = valor;
  }
  return {
    multiplicadorMinimoEscalado: entrada.multiplicadorMinimoEscalado,
    multiplicadorMaximoEscalado: entrada.multiplicadorMaximoEscalado,
    lluviaConPrecipitacionEscalado: entrada.lluviaConPrecipitacionEscalado,
    lluviaSinPrecipitacionEscalado: entrada.lluviaSinPrecipitacionEscalado,
    disponibilidad,
    demandaPorMil,
    horario
  };
}

/** Caso de uso para consultar y versionar la regla dinámica sin mutar versiones previas. */
export class GestionarReglaDemanda {
  constructor(private readonly reglas: RepositorioVersionesRegla) {}

  async consultar(): Promise<ReglaSnapshot> {
    const [activa, historial] = await Promise.all([this.reglas.obtenerActiva(), this.reglas.listarHistorial()]);
    return { activa: structuredClone(activa), historial: structuredClone(historial) };
  }

  async actualizar(
    autorId: string,
    entrada: Partial<NuevaReglaDemandaInput>,
    ahora = new Date()
  ): Promise<ReglaSnapshot> {
    if (!autorId.trim()) {
      throw new ErrorTarifas("ACTOR_INVALIDO", "Falta el identificador del administrador autenticado.");
    }
    const actual = await this.reglas.obtenerActiva();
    const combinada = validarReglaDemandaInput({
      multiplicadorMinimoEscalado: entrada.multiplicadorMinimoEscalado ?? actual.multiplicadorMinimoEscalado,
      multiplicadorMaximoEscalado: entrada.multiplicadorMaximoEscalado ?? actual.multiplicadorMaximoEscalado,
      lluviaConPrecipitacionEscalado: entrada.lluviaConPrecipitacionEscalado ?? actual.lluviaConPrecipitacionEscalado,
      lluviaSinPrecipitacionEscalado: entrada.lluviaSinPrecipitacionEscalado ?? actual.lluviaSinPrecipitacionEscalado,
      disponibilidad: entrada.disponibilidad ?? actual.disponibilidad,
      demandaPorMil: entrada.demandaPorMil ?? actual.demandaPorMil,
      horario: entrada.horario ? { ...actual.horario, ...entrada.horario } : actual.horario
    });
    const nueva = await this.reglas.crearNuevaVersion({
      tarifaBasePesos: actual.tarifaBasePesos,
      precioPorKilometroPesos: actual.precioPorKilometroPesos,
      precioPorMinutoPesos: actual.precioPorMinutoPesos,
      ...combinada,
      autorId: autorId.trim(),
      creadaEn: new Date(ahora)
    });
    const historial = await this.reglas.listarHistorial();
    return { activa: structuredClone(nueva), historial: structuredClone(historial) };
  }
}

export class RepositorioReglasMemoria implements RepositorioVersionesRegla {
  private readonly versiones: ReglaTarifa[];

  constructor(inicial: ReglaTarifa) {
    this.versiones = [{
      ...structuredClone(inicial),
      autorId: inicial.autorId ?? "sistema",
      creadaEn: inicial.creadaEn ? new Date(inicial.creadaEn) : new Date("2026-11-02T13:00:00.000Z"),
      activa: true
    }];
  }

  async obtenerActiva(): Promise<ReglaTarifa> {
    const activa = this.versiones.find((r) => r.activa !== false) ?? this.versiones.at(-1);
    if (!activa) throw new ErrorTarifas("REGLA_NO_CONFIGURADA", "No hay una regla de tarifa activa.");
    return structuredClone(activa);
  }

  async listarHistorial(): Promise<ReglaTarifa[]> {
    return structuredClone([...this.versiones].sort((a, b) => b.version - a.version));
  }

  async crearNuevaVersion(datos: Omit<ReglaTarifa, "version" | "activa">): Promise<ReglaTarifa> {
    const ultimaVersion = this.versiones.reduce((max, item) => Math.max(max, item.version), 0);
    for (const item of this.versiones) item.activa = false;
    const creada: ReglaTarifa = {
      ...structuredClone(datos),
      version: ultimaVersion + 1,
      activa: true,
      autorId: datos.autorId ?? "sistema",
      creadaEn: datos.creadaEn ? new Date(datos.creadaEn) : new Date()
    };
    this.versiones.push(creada);
    return structuredClone(creada);
  }
}
