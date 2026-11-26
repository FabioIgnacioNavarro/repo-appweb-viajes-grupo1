export type Rol = "PASAJERO" | "CHOFER" | "SOPORTE" | "ADMINISTRADOR";

export type EstadoViaje =
  | "SOLICITADO"
  | "ASIGNADO"
  | "CHOFER_EN_CAMINO"
  | "EN_CURSO"
  | "FINALIZADO"
  | "CANCELADO_POR_PASAJERO"
  | "CANCELADO_POR_CHOFER"
  | "CANCELADO_POR_OPERADOR"
  | "SIN_CHOFERES_DISPONIBLES";

export interface ActorAutenticado {
  idUsuario: string;
  rol: Rol;
}

/** Puerto de salida para eventos efímeros; el adaptador de transporte queda fuera del dominio. */
export interface PublicadorEventosTiempoReal {
  publicarAUsuario(idUsuario: string, evento: string, datos: Record<string, unknown>): void;
}

/** Regla de distribución de cambios: solo los participantes persistidos reciben el estado del viaje. */
export class PublicarEstadoViaje {
  constructor(private readonly eventos: PublicadorEventosTiempoReal) {}
  ejecutar(viaje: Viaje): void {
    const datos = { id_viaje: viaje.id, estado: viaje.estado.toLowerCase(), id_chofer: viaje.choferId ?? null, actualizado_en: new Date().toISOString() };
    try {
      this.eventos.publicarAUsuario(viaje.pasajeroId, "ESTADO_VIAJE_ACTUALIZADO", datos);
      if (viaje.choferId) this.eventos.publicarAUsuario(viaje.choferId, "ESTADO_VIAJE_ACTUALIZADO", datos);
    } catch { /* La publicación efímera no revierte el estado persistido. */ }
  }
}

/** Publica únicamente una ubicación nueva de un chofer con viaje activo, y la degrada antes de exponerla. */
export class PublicarUbicacionChoferEnViaje {
  constructor(private readonly viajes: RepositorioViajes, private readonly eventos: PublicadorEventosTiempoReal) {}
  async ejecutar(actor: ActorAutenticado, ubicacion: { latitud: number; longitud: number; actualizadoEn: string }): Promise<boolean> {
    exigirRol(actor, "CHOFER", "ADMINISTRADOR");
    const viaje = await this.viajes.obtenerActivoPorChofer(actor.idUsuario);
    if (!viaje || viaje.choferId !== actor.idUsuario || !["CHOFER_EN_CAMINO", "EN_CURSO"].includes(viaje.estado)) return false;
    try {
      this.eventos.publicarAUsuario(viaje.pasajeroId, "UBICACION_CHOFER_ACTUALIZADA", {
        id_viaje: viaje.id,
        latitud: Math.round(ubicacion.latitud * 1000) / 1000,
        longitud: Math.round(ubicacion.longitud * 1000) / 1000,
        actualizado_en: ubicacion.actualizadoEn
      });
    } catch { /* La publicación efímera no revierte el estado persistido. */ }
    return true;
  }
}

export interface Coordenada {
  latitud: number;
  longitud: number;
  direccion?: string;
}

export interface EstimacionVigente {
  id: string;
  origen: Coordenada;
  destino: Coordenada;
  precioEstimado: string;
  moneda: "ARS";
  multiplicadorDemanda: number;
  factoresPrecio: Record<string, unknown>;
  versionRegla: number;
  creadaEn: Date;
  vigenteHasta: Date;
}

export interface Viaje {
  id: string;
  pasajeroId: string;
  choferId?: string;
  origen: Coordenada;
  destino: Coordenada;
  estimacionId: string;
  precioEstimado: string;
  precioFinal?: string;
  moneda: "ARS";
  multiplicadorDemanda: number;
  factoresPrecio: Record<string, unknown>;
  estado: EstadoViaje;
  creadoEn: Date;
  iniciadoEm?: Date;
  finalizadoEm?: Date;
  canceladoEm?: Date;
  motivoCancelacion?: string;
}

export interface FiltrosListadoViajes {
  estado?: EstadoViaje;
  participanteId?: string;
  desde?: Date;
  hasta?: Date;
  limite?: number;
  desplazamiento?: number;
}

export type EstadoOferta = "PENDIENTE" | "ACEPTADA" | "RECHAZADA" | "VENCIDA" | "CANCELADA" | "NO_SELECCIONADA";

export interface Oferta {
  id: string;
  viajeId: string;
  choferId: string;
  estado: EstadoOferta;
  enviadaEm: Date;
  expiraEm: Date;
  respondidaEm?: Date;
}

export type EstadoCobro = "PENDIENTE" | "FALLIDO" | "CONFIRMADO";

export interface Cobro {
  id: string;
  viajeId: string;
  importe: string;
  moneda: "ARS";
  estado: EstadoCobro;
  intentos: number;
  creadoEn: Date;
}

/** Puerto de salida para simular o integrar el procesamiento de un cobro. */
export interface PasarelaPagos {
  procesar(cobro: Cobro, claveIdempotencia: string): Promise<"FALLIDO" | "CONFIRMADO">;
}

export interface RepositorioViajes {
  guardar(viaje: Viaje): Promise<Viaje>;
  obtener(id: string): Promise<Viaje | undefined>;
  obtenerActivoPorChofer(idChofer: string): Promise<Viaje | undefined>;
  listar(filtros?: FiltrosListadoViajes): Promise<Viaje[]>;
  contar(filtros?: Omit<FiltrosListadoViajes, "limite" | "desplazamiento">): Promise<number>;
}

export interface RepositorioOfertas {
  guardar(oferta: Oferta): Promise<Oferta>;
  obtener(id: string): Promise<Oferta | undefined>;
  listarPorChofer(choferId: string): Promise<Oferta[]>;
  listarPorViaje(viajeId: string): Promise<Oferta[]>;
}

export interface RepositorioCobros {
  guardar(cobro: Cobro): Promise<Cobro>;
  obtenerPorViaje(viajeId: string): Promise<Cobro | undefined>;
}

export interface RepositorioIdempotencia {
  obtener(actorId: string, clave: string, operacion?: string): Promise<unknown | undefined>;
  guardar(actorId: string, clave: string, resultado: unknown, operacion?: string): Promise<void>;
}

/** Repositorios disponibles dentro de una confirmación transaccional serializada por clave. */
export interface RepositoriosConfirmacionTransaccionales {
  viajes: RepositorioViajes;
  idempotencia: RepositorioIdempotencia;
}

/** Puerto de exclusión mutua por clave de idempotencia; en PostgreSQL usa lock transaccional. */
export interface EjecutorIdempotente {
  ejecutar<T>(
    actorId: string,
    clave: string,
    operacion: string,
    trabajo: (repositorios: RepositoriosConfirmacionTransaccionales) => Promise<T>
  ): Promise<T>;
}

/** Repositorios con bloqueos explícitos disponibles solo dentro de una transacción local. */
export interface RepositoriosViajeTransaccionales {
  viajes: RepositorioViajes & { obtenerParaActualizar(id: string): Promise<Viaje | undefined> };
  ofertas: RepositorioOfertas & { obtenerParaActualizar(id: string): Promise<Oferta | undefined> };
}

/** Puerto de unidad de trabajo; el dominio define la operación y el adaptador controla BEGIN/COMMIT/ROLLBACK. */
export interface TransaccionViajes {
  ejecutar<T>(operacion: (repositorios: RepositoriosViajeTransaccionales) => Promise<T>): Promise<T>;
}

/** Puerto para obtener candidatos; no conoce HTTP ni JWT. */
export interface FuenteCandidatos {
  buscar(origen: Coordenada, jwt: string): Promise<string[]>;
}

/** El adaptador real debe implementar esta operación dentro de una transacción. */
export interface AsignadorAtomico {
  intentarAsignar(viajeId: string, choferId: string): Promise<boolean>;
  liberar(viajeId: string, choferId: string): Promise<void>;
}

export interface GeneradorId {
  generar(prefijo: string): string;
}

export class ErrorDominio extends Error {
  constructor(public readonly codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "ErrorDominio";
  }
}

/** Matriz única de transiciones del viaje, compartida por casos de uso y el adaptador SQL. */
export const transicionesViajePermitidas: Readonly<Record<EstadoViaje, readonly EstadoViaje[]>> = {
  SOLICITADO: ["ASIGNADO", "SIN_CHOFERES_DISPONIBLES", "CANCELADO_POR_PASAJERO", "CANCELADO_POR_OPERADOR"],
  ASIGNADO: ["CHOFER_EN_CAMINO", "CANCELADO_POR_PASAJERO", "CANCELADO_POR_CHOFER", "CANCELADO_POR_OPERADOR"],
  CHOFER_EN_CAMINO: ["EN_CURSO", "CANCELADO_POR_PASAJERO", "CANCELADO_POR_CHOFER", "CANCELADO_POR_OPERADOR"],
  EN_CURSO: ["FINALIZADO", "CANCELADO_POR_OPERADOR"],
  FINALIZADO: [],
  CANCELADO_POR_PASAJERO: [],
  CANCELADO_POR_CHOFER: [],
  CANCELADO_POR_OPERADOR: [],
  SIN_CHOFERES_DISPONIBLES: []
};

export function transicionPermitidaViaje(origen: EstadoViaje, destino: EstadoViaje): boolean {
  return transicionesViajePermitidas[origen].includes(destino);
}

export function estadosOrigenPermitidos(destino: EstadoViaje): EstadoViaje[] {
  return (Object.keys(transicionesViajePermitidas) as EstadoViaje[])
    .filter((origen) => transicionPermitidaViaje(origen, destino));
}

export function exigirTransicionViaje(origen: EstadoViaje, destino: EstadoViaje): void {
  if (!transicionPermitidaViaje(origen, destino)) {
    throw new ErrorDominio("TRANSICION_ESTADO_INVALIDA", `No se permite pasar de ${origen} a ${destino}.`);
  }
}

export class GeneradorIdMemoria implements GeneradorId {
  private secuencia = 0;

  generar(prefijo: string): string {
    this.secuencia += 1;
    return `${prefijo}-${this.secuencia}`;
  }
}

export class RepositorioViajesMemoria implements RepositorioViajes {
  private readonly datos = new Map<string, Viaje>();

  async guardar(viaje: Viaje): Promise<Viaje> {
    const anterior = this.datos.get(viaje.id);
    if (anterior) exigirTransicionViaje(anterior.estado, viaje.estado);
    const copia = structuredClone(viaje);
    this.datos.set(viaje.id, copia);
    return structuredClone(copia);
  }

  async obtener(id: string): Promise<Viaje | undefined> {
    const viaje = this.datos.get(id);
    return viaje ? structuredClone(viaje) : undefined;
  }

  async obtenerActivoPorChofer(idChofer: string): Promise<Viaje | undefined> {
    const viaje = [...this.datos.values()].find((item) => item.choferId === idChofer && ESTADOS_QUE_OCUPAN_CHOFER.has(item.estado));
    return viaje ? structuredClone(viaje) : undefined;
  }

  private filtrar(filtros: Omit<FiltrosListadoViajes, "limite" | "desplazamiento"> = {}): Viaje[] {
    return [...this.datos.values()].filter((viaje) =>
      (!filtros.participanteId || viaje.pasajeroId === filtros.participanteId || viaje.choferId === filtros.participanteId)
      && (!filtros.estado || viaje.estado === filtros.estado)
      && (!filtros.desde || viaje.creadoEn.getTime() >= filtros.desde.getTime())
      && (!filtros.hasta || viaje.creadoEn.getTime() < filtros.hasta.getTime())
    ).sort((a, b) => b.creadoEn.getTime() - a.creadoEn.getTime());
  }

  async listar(filtros: FiltrosListadoViajes = {}): Promise<Viaje[]> {
    const viajes = this.filtrar(filtros);
    const inicio = filtros.desplazamiento ?? 0;
    const fin = filtros.limite === undefined ? undefined : inicio + filtros.limite;
    return viajes.slice(inicio, fin).map((viaje) => structuredClone(viaje));
  }

  async contar(filtros: Omit<FiltrosListadoViajes, "limite" | "desplazamiento"> = {}): Promise<number> {
    return this.filtrar(filtros).length;
  }
}

const ESTADOS_QUE_OCUPAN_CHOFER = new Set<EstadoViaje>(["ASIGNADO", "CHOFER_EN_CAMINO", "EN_CURSO"]);

/** Consultas de servicio usadas por los adaptadores internos de integración. */
export class ConsultarDemandaPorZona {
  constructor(private readonly viajes: RepositorioViajes) {}
  async ejecutar(zonaId: string): Promise<number> {
    const lista = await this.viajes.listar();
    return lista.filter((viaje) => viaje.estado === "SOLICITADO" && viaje.factoresPrecio.zona_id === zonaId).length;
  }
}

export class ConsultarChoferesOcupados {
  constructor(private readonly viajes: RepositorioViajes) {}
  async ejecutar(idsChoferes: string[]): Promise<string[]> {
    const solicitados = new Set(idsChoferes);
    const lista = await this.viajes.listar();
    return [...new Set(lista.filter((viaje) => ESTADOS_QUE_OCUPAN_CHOFER.has(viaje.estado) && viaje.choferId && solicitados.has(viaje.choferId)).map((viaje) => viaje.choferId!))];
  }
}

export class RepositorioOfertasMemoria implements RepositorioOfertas {
  private readonly datos = new Map<string, Oferta>();

  async guardar(oferta: Oferta): Promise<Oferta> {
    const copia = structuredClone(oferta);
    this.datos.set(oferta.id, copia);
    return structuredClone(copia);
  }

  async obtener(id: string): Promise<Oferta | undefined> {
    const oferta = this.datos.get(id);
    return oferta ? structuredClone(oferta) : undefined;
  }

  async listarPorChofer(choferId: string): Promise<Oferta[]> {
    return [...this.datos.values()].filter((oferta) => oferta.choferId === choferId).map((oferta) => structuredClone(oferta));
  }

  async listarPorViaje(viajeId: string): Promise<Oferta[]> {
    return [...this.datos.values()].filter((oferta) => oferta.viajeId === viajeId).map((oferta) => structuredClone(oferta));
  }
}

/** Regla de aplicación: solo abre ofertas para un viaje solicitado y evita duplicarlas en reintentos.
 * Por defecto la vigencia es de 30 segundos (30_000 ms), conforme al rango de 15 a 30s sugerido por el TP. */
export class CrearOfertasParaCandidatos {
  constructor(private readonly ofertas: RepositorioOfertas, private readonly ids: GeneradorId) {}
  async ejecutar(viaje: Viaje, choferes: string[], ahora = new Date(), vigenciaMs = 30_000): Promise<Oferta[]> {
    if (viaje.estado !== "SOLICITADO") throw new ErrorDominio("VIAJE_NO_OFERTABLE", "El viaje no admite nuevas ofertas.");
    if (!Number.isSafeInteger(vigenciaMs) || vigenciaMs <= 0) throw new ErrorDominio("OFERTA_INVALIDA", "La vigencia de oferta no es válida.");
    const existentes = new Set((await this.ofertas.listarPorViaje(viaje.id)).map((oferta) => oferta.choferId));
    const unicos = [...new Set(choferes)].filter((id) => id && !existentes.has(id)).slice(0, 20);
    const creadas: Oferta[] = [];
    for (const choferId of unicos) {
      const guardada = await this.ofertas.guardar({
        id: this.ids.generar("oferta"),
        viajeId: viaje.id,
        choferId,
        estado: "PENDIENTE",
        enviadaEm: new Date(ahora),
        expiraEm: new Date(ahora.getTime() + vigenciaMs)
      });
      creadas.push(guardada);
    }
    return creadas;
  }
}

export class RepositorioCobrosMemoria implements RepositorioCobros {
  private readonly datos = new Map<string, Cobro>();

  async guardar(cobro: Cobro): Promise<Cobro> {
    const existente = this.datos.get(cobro.viajeId);
    if (existente?.estado === "CONFIRMADO") return structuredClone(existente);
    const copia = structuredClone(existente
      ? { ...cobro, id: existente.id, creadoEn: existente.creadoEn, intentos: Math.max(existente.intentos, cobro.intentos) }
      : cobro);
    this.datos.set(cobro.viajeId, copia);
    return structuredClone(copia);
  }

  async obtenerPorViaje(viajeId: string): Promise<Cobro | undefined> {
    const cobro = this.datos.get(viajeId);
    return cobro ? structuredClone(cobro) : undefined;
  }
}

export class RepositorioIdempotenciaMemoria implements RepositorioIdempotencia {
  private readonly datos = new Map<string, unknown>();

  async obtener(actorId: string, clave: string, operacion = "confirmar_viaje"): Promise<unknown | undefined> {
    return structuredClone(this.datos.get(`${actorId}:${operacion}:${clave}`));
  }

  async guardar(actorId: string, clave: string, resultado: unknown, operacion = "confirmar_viaje"): Promise<void> {
    this.datos.set(`${actorId}:${operacion}:${clave}`, structuredClone(resultado));
  }
}

/** Serializa en memoria peticiones concurrentes que comparten actor, operación y clave de idempotencia. */
export class EjecutorIdempotenteMemoria implements EjecutorIdempotente {
  private readonly bloqueos = new Map<string, Promise<void>>();

  constructor(
    private readonly viajes: RepositorioViajes,
    private readonly idempotencia: RepositorioIdempotencia
  ) {}

  async ejecutar<T>(
    actorId: string,
    clave: string,
    operacion: string,
    trabajo: (repositorios: RepositoriosConfirmacionTransaccionales) => Promise<T>
  ): Promise<T> {
    const llave = `${actorId}:${operacion}:${clave}`;
    const previo = this.bloqueos.get(llave) ?? Promise.resolve();
    let liberar!: () => void;
    const actual = new Promise<void>((resolver) => { liberar = resolver; });
    const cola = previo.then(() => actual);
    this.bloqueos.set(llave, cola);
    await previo;
    try {
      return await trabajo({ viajes: this.viajes, idempotencia: this.idempotencia });
    } finally {
      liberar();
      if (this.bloqueos.get(llave) === cola) {
        this.bloqueos.delete(llave);
      }
    }
  }
}

export class AsignadorAtomicoMemoria implements AsignadorAtomico {
  private readonly porViaje = new Map<string, string>();
  private readonly porChofer = new Map<string, string>();

  async intentarAsignar(viajeId: string, choferId: string): Promise<boolean> {
    if (this.porViaje.has(viajeId) || this.porChofer.has(choferId)) return false;
    this.porViaje.set(viajeId, choferId);
    this.porChofer.set(choferId, viajeId);
    return true;
  }

  async liberar(viajeId: string, choferId: string): Promise<void> {
    if (this.porViaje.get(viajeId) === choferId) this.porViaje.delete(viajeId);
    if (this.porChofer.get(choferId) === viajeId) this.porChofer.delete(choferId);
  }
}

function exigirRol(actor: ActorAutenticado, ...roles: Rol[]): void {
  if (!roles.includes(actor.rol)) throw new ErrorDominio("ROL_NO_AUTORIZADO", "El rol no puede ejecutar esta operacion.");
}

function exigirViaje(viaje: Viaje | undefined): Viaje {
  if (!viaje) throw new ErrorDominio("VIAJE_NO_ENCONTRADO", "El viaje no existe.");
  return viaje;
}

function exigirEstimacionVigente(estimacion: EstimacionVigente, ahora: Date): void {
  if (estimacion.vigenteHasta.getTime() <= ahora.getTime()) {
    throw new ErrorDominio("ESTIMACION_VENCIDA", "La estimacion ya no puede confirmarse.");
  }
}

function exigirImporte(importe: string): void {
  if (!/^[0-9]+$/.test(importe)) throw new ErrorDominio("IMPORTE_INVALIDO", "El importe debe ser un entero de pesos.");
}

export class ConfirmarViaje {
  private readonly ejecutor: EjecutorIdempotente;

  constructor(
    private readonly viajes: RepositorioViajes,
    private readonly idempotencia: RepositorioIdempotencia,
    private readonly ids: GeneradorId,
    ejecutor?: EjecutorIdempotente
  ) {
    this.ejecutor = ejecutor ?? new EjecutorIdempotenteMemoria(viajes, idempotencia);
  }

  async ejecutar(actor: ActorAutenticado, estimacion: EstimacionVigente, clave: string, ahora = new Date()): Promise<Viaje> {
    const { viaje } = await this.ejecutarConRegistro(actor, estimacion, clave, ahora);
    return viaje;
  }

  async ejecutarConRegistro(
    actor: ActorAutenticado,
    estimacion: EstimacionVigente,
    clave: string,
    ahora = new Date()
  ): Promise<{ viaje: Viaje; creado: boolean }> {
    exigirRol(actor, "PASAJERO", "ADMINISTRADOR");
    if (!clave) throw new ErrorDominio("CLAVE_IDEMPOTENCIA_REQUERIDA", "La confirmacion requiere una clave de idempotencia.");
    return await this.ejecutor.ejecutar(actor.idUsuario, clave, "confirmar_viaje", async ({ viajes, idempotencia }) => {
      const anterior = (await idempotencia.obtener(actor.idUsuario, clave, "confirmar_viaje")) as Viaje | undefined;
      if (anterior) {
        return { viaje: (await viajes.obtener(anterior.id)) ?? anterior, creado: false };
      }
      exigirEstimacionVigente(estimacion, ahora);
      exigirImporte(estimacion.precioEstimado);
      const viaje: Viaje = {
        id: this.ids.generar("viaje"),
        pasajeroId: actor.idUsuario,
        origen: structuredClone(estimacion.origen),
        destino: structuredClone(estimacion.destino),
        estimacionId: estimacion.id,
        precioEstimado: estimacion.precioEstimado,
        moneda: "ARS",
        multiplicadorDemanda: estimacion.multiplicadorDemanda,
        factoresPrecio: { ...structuredClone(estimacion.factoresPrecio), version_regla: estimacion.versionRegla },
        estado: "SOLICITADO",
        creadoEn: new Date(ahora)
      };
      const guardado = await viajes.guardar(viaje);
      await idempotencia.guardar(actor.idUsuario, clave, guardado, "confirmar_viaje");
      return { viaje: guardado, creado: true };
    });
  }
}

export class CrearOferta {
  constructor(private readonly ofertas: RepositorioOfertas, private readonly viajes: RepositorioViajes, private readonly ids: GeneradorId) {}

  async ejecutar(actor: ActorAutenticado, viajeId: string, choferId: string, expiraEn: Date, ahora = new Date()): Promise<Oferta> {
    exigirRol(actor, "SOPORTE", "ADMINISTRADOR");
    const viaje = exigirViaje(await this.viajes.obtener(viajeId));
    if (viaje.estado !== "SOLICITADO") throw new ErrorDominio("VIAJE_NO_OFERTABLE", "El viaje no admite nuevas ofertas.");
    if (expiraEn.getTime() <= ahora.getTime()) throw new ErrorDominio("OFERTA_INVALIDA", "La oferta debe vencer en el futuro.");
    return await this.ofertas.guardar({ id: this.ids.generar("oferta"), viajeId, choferId, estado: "PENDIENTE", enviadaEm: new Date(ahora), expiraEm: new Date(expiraEn) });
  }
}

export class AceptarOferta {
  constructor(
    private readonly ofertas: RepositorioOfertas,
    private readonly viajes: RepositorioViajes,
    private readonly asignador: AsignadorAtomico,
    private readonly eventos?: PublicadorEventosTiempoReal,
    private readonly transaccion?: TransaccionViajes
  ) {}

  async ejecutar(actor: ActorAutenticado, ofertaId: string, ahora = new Date()): Promise<Viaje> {
    exigirRol(actor, "CHOFER", "ADMINISTRADOR");
    if (this.transaccion) return await this.ejecutarTransaccional(actor, ofertaId, ahora);

    const oferta = await this.ofertas.obtener(ofertaId);
    if (!oferta) throw new ErrorDominio("OFERTA_NO_ENCONTRADA", "La oferta no existe.");
    if (oferta.choferId !== actor.idUsuario) throw new ErrorDominio("OFERTA_NO_AUTORIZADA", "La oferta no pertenece al chofer.");
    if (oferta.estado !== "PENDIENTE") throw new ErrorDominio("OFERTA_NO_DISPONIBLE", "La oferta ya fue respondida.");
    if (oferta.expiraEm.getTime() <= ahora.getTime()) {
      const vencida = await this.ofertas.guardar({ ...oferta, estado: "VENCIDA", respondidaEm: new Date(ahora) });
      publicarEstadoOferta(this.eventos, vencida, "OFERTA_VENCIDA", "vigencia_vencida");
      throw new ErrorDominio("OFERTA_VENCIDA", "La oferta ya vencio.");
    }
    const viaje = exigirViaje(await this.viajes.obtener(oferta.viajeId));
    exigirTransicionViaje(viaje.estado, "ASIGNADO");
    if (!(await this.asignador.intentarAsignar(viaje.id, actor.idUsuario))) throw new ErrorDominio("ASIGNACION_EN_CONFLICTO", "El viaje o el chofer ya fueron asignados.");
    const actualizado = await this.viajes.guardar({ ...viaje, choferId: actor.idUsuario, estado: "ASIGNADO" });
    await this.ofertas.guardar({ ...oferta, estado: "ACEPTADA", respondidaEm: new Date(ahora) });
    for (const otra of await this.ofertas.listarPorViaje(viaje.id)) {
      if (otra.id !== oferta.id && otra.estado === "PENDIENTE") {
        const noSeleccionada = await this.ofertas.guardar({ ...otra, estado: "NO_SELECCIONADA", respondidaEm: new Date(ahora) });
        publicarEstadoOferta(this.eventos, noSeleccionada, "OFERTA_CANCELADA", "viaje_asignado");
      }
    }
    return actualizado;
  }

  private async ejecutarTransaccional(actor: ActorAutenticado, ofertaId: string, ahora: Date): Promise<Viaje> {
    type Resultado = { viaje?: Viaje; notificaciones: Oferta[]; error?: ErrorDominio };
    const resultado = await this.transaccion!.ejecutar<Resultado>(async ({ viajes, ofertas }) => {
      // Se lee la oferta sin bloquear solo para conocer el viaje; el orden de locks sigue siendo viaje y luego oferta.
      const ofertaInicial = await ofertas.obtener(ofertaId);
      if (!ofertaInicial) throw new ErrorDominio("OFERTA_NO_ENCONTRADA", "La oferta no existe.");
      const viaje = exigirViaje(await viajes.obtenerParaActualizar(ofertaInicial.viajeId));
      const oferta = await ofertas.obtenerParaActualizar(ofertaId);
      if (!oferta) throw new ErrorDominio("OFERTA_NO_ENCONTRADA", "La oferta no existe.");
      if (oferta.viajeId !== viaje.id) throw new ErrorDominio("OFERTA_NO_DISPONIBLE", "La oferta ya no corresponde al viaje.");
      if (oferta.choferId !== actor.idUsuario) throw new ErrorDominio("OFERTA_NO_AUTORIZADA", "La oferta no pertenece al chofer.");
      exigirTransicionViaje(viaje.estado, "ASIGNADO");
      if (oferta.estado !== "PENDIENTE") throw new ErrorDominio("OFERTA_NO_DISPONIBLE", "La oferta ya fue respondida.");
      if (oferta.expiraEm.getTime() <= ahora.getTime()) {
        const vencida = await ofertas.guardar({ ...oferta, estado: "VENCIDA", respondidaEm: new Date(ahora) });
        return { notificaciones: [vencida], error: new ErrorDominio("OFERTA_VENCIDA", "La oferta ya vencio.") };
      }

      // Las restricciones de PostgreSQL son la última defensa ante carreras entre viajes distintos.
      const actualizado = await viajes.guardar({ ...viaje, choferId: actor.idUsuario, estado: "ASIGNADO" });
      await ofertas.guardar({ ...oferta, estado: "ACEPTADA", respondidaEm: new Date(ahora) });
      const notificaciones: Oferta[] = [];
      for (const otra of await ofertas.listarPorViaje(viaje.id)) {
        if (otra.id !== oferta.id && otra.estado === "PENDIENTE") {
          notificaciones.push(await ofertas.guardar({ ...otra, estado: "NO_SELECCIONADA", respondidaEm: new Date(ahora) }));
        }
      }
      return { viaje: actualizado, notificaciones };
    });

    for (const oferta of resultado.notificaciones) {
      if (oferta.estado === "VENCIDA") publicarEstadoOferta(this.eventos, oferta, "OFERTA_VENCIDA", "vigencia_vencida");
      if (oferta.estado === "NO_SELECCIONADA") publicarEstadoOferta(this.eventos, oferta, "OFERTA_CANCELADA", "viaje_asignado");
    }
    if (resultado.error) throw resultado.error;
    return exigirViaje(resultado.viaje);
  }
}

export class RechazarOferta {
  constructor(private readonly ofertas: RepositorioOfertas) {}

  async ejecutar(actor: ActorAutenticado, ofertaId: string, ahora = new Date()): Promise<Oferta> {
    exigirRol(actor, "CHOFER", "ADMINISTRADOR");
    const oferta = await this.ofertas.obtener(ofertaId);
    if (!oferta) throw new ErrorDominio("OFERTA_NO_ENCONTRADA", "La oferta no existe.");
    if (oferta.choferId !== actor.idUsuario) throw new ErrorDominio("OFERTA_NO_AUTORIZADA", "La oferta no pertenece al chofer.");
    if (oferta.estado !== "PENDIENTE") throw new ErrorDominio("OFERTA_NO_DISPONIBLE", "La oferta ya fue respondida.");
    return await this.ofertas.guardar({ ...oferta, estado: "RECHAZADA", respondidaEm: new Date(ahora) });
  }
}

export class ConsultarViaje {
  constructor(private readonly viajes: RepositorioViajes) {}

  async ejecutar(actor: ActorAutenticado, viajeId: string): Promise<Viaje> {
    const viaje = exigirViaje(await this.viajes.obtener(viajeId));
    const autorizado = viaje.pasajeroId === actor.idUsuario || viaje.choferId === actor.idUsuario || actor.rol === "SOPORTE" || actor.rol === "ADMINISTRADOR";
    if (!autorizado) throw new ErrorDominio("VIAJE_NO_AUTORIZADO", "El actor no puede consultar este viaje.");
    return viaje;
  }
}

export interface ConsultaViajesOperador {
  estado?: EstadoViaje;
  desde?: Date;
  hasta?: Date;
  pagina?: number;
  limite?: number;
}

export interface ResultadoListadoViajesOperador {
  viajes: Viaje[];
  pagina: number;
  limite: number;
  total: number;
}

/** Búsqueda global paginada; la autorización se mantiene dentro del dominio. */
export class ListarViajesOperador {
  constructor(private readonly viajes: RepositorioViajes) {}

  async ejecutar(actor: ActorAutenticado, consulta: ConsultaViajesOperador = {}): Promise<ResultadoListadoViajesOperador> {
    exigirRol(actor, "SOPORTE", "ADMINISTRADOR");
    const pagina = consulta.pagina ?? 1;
    const limite = consulta.limite ?? 20;
    if (!Number.isSafeInteger(pagina) || pagina < 1 || !Number.isSafeInteger(limite) || limite < 1 || limite > 100
      || !Number.isSafeInteger((pagina - 1) * limite)
      || (consulta.desde && !Number.isFinite(consulta.desde.getTime()))
      || (consulta.hasta && !Number.isFinite(consulta.hasta.getTime()))
      || (consulta.desde && consulta.hasta && consulta.desde.getTime() >= consulta.hasta.getTime())) {
      throw new ErrorDominio("ENTRADA_INVALIDA", "Los filtros o la paginación no son válidos.");
    }
    const filtros = {
      estado: consulta.estado,
      desde: consulta.desde,
      hasta: consulta.hasta,
      limite,
      desplazamiento: (pagina - 1) * limite
    };
    const [viajes, total] = await Promise.all([
      this.viajes.listar(filtros),
      this.viajes.contar({ estado: filtros.estado, desde: filtros.desde, hasta: filtros.hasta })
    ]);
    return { viajes, pagina, limite, total };
  }
}

export interface AuditoriaTarifaViaje {
  idViaje: string;
  idEstimacion: string;
  precioConfirmado: string;
  moneda: "ARS";
  multiplicadorDemanda: number;
  factoresPrecio: Record<string, unknown>;
  versionRegla: number | null;
  congeladaEn: Date;
}

/** Lee únicamente el snapshot persistido; nunca consulta ni recalcula una tarifa. */
export class ConsultarAuditoriaTarifa {
  constructor(private readonly viajes: RepositorioViajes) {}

  async ejecutar(actor: ActorAutenticado, viajeId: string): Promise<AuditoriaTarifaViaje> {
    exigirRol(actor, "SOPORTE", "ADMINISTRADOR");
    const viaje = exigirViaje(await this.viajes.obtener(viajeId));
    const version = viaje.factoresPrecio.version_regla;
    return {
      idViaje: viaje.id,
      idEstimacion: viaje.estimacionId,
      precioConfirmado: viaje.precioEstimado,
      moneda: viaje.moneda,
      multiplicadorDemanda: viaje.multiplicadorDemanda,
      factoresPrecio: structuredClone(viaje.factoresPrecio),
      versionRegla: typeof version === "number" && Number.isSafeInteger(version) ? version : null,
      congeladaEn: new Date(viaje.creadoEn)
    };
  }
}

export class CancelarViaje {
  constructor(private readonly viajes: RepositorioViajes, private readonly asignador: AsignadorAtomico, private readonly ofertas?: RepositorioOfertas, private readonly eventos?: PublicadorEventosTiempoReal) {}

  async ejecutar(actor: ActorAutenticado, viajeId: string, motivo: string, ahora = new Date()): Promise<Viaje> {
    const viaje = exigirViaje(await this.viajes.obtener(viajeId));
    const estado = actor.rol === "PASAJERO" ? "CANCELADO_POR_PASAJERO" : actor.rol === "CHOFER" ? "CANCELADO_POR_CHOFER" : actor.rol === "SOPORTE" || actor.rol === "ADMINISTRADOR" ? "CANCELADO_POR_OPERADOR" : undefined;
    if (!estado || (actor.rol === "PASAJERO" && viaje.pasajeroId !== actor.idUsuario) || (actor.rol === "CHOFER" && viaje.choferId !== actor.idUsuario)) throw new ErrorDominio("VIAJE_NO_AUTORIZADO", "El actor no puede cancelar este viaje.");
    exigirTransicionViaje(viaje.estado, estado);
    if (viaje.choferId) await this.asignador.liberar(viaje.id, viaje.choferId);
    const cancelado = await this.viajes.guardar({ ...viaje, estado, motivoCancelacion: motivo, canceladoEm: new Date(ahora) });
    const ofertas = this.ofertas ? await this.ofertas.listarPorViaje(viaje.id) : [];
    for (const oferta of ofertas) {
      if (oferta.estado === "PENDIENTE") {
        const anulada = await this.ofertas!.guardar({ ...oferta, estado: "CANCELADA", respondidaEm: new Date(ahora) });
        publicarEstadoOferta(this.eventos, anulada, "OFERTA_CANCELADA", "viaje_cancelado");
      }
    }
    return cancelado;
  }
}

/** Marca terminal un viaje sin candidatos; la invoca la integración si Flota responde vacío. */
export class MarcarViajeSinChoferesDisponibles {
  constructor(private readonly viajes: RepositorioViajes) {}
  async ejecutar(viajeId: string): Promise<Viaje> {
    const viaje = exigirViaje(await this.viajes.obtener(viajeId));
    exigirTransicionViaje(viaje.estado, "SIN_CHOFERES_DISPONIBLES");
    return await this.viajes.guardar({ ...viaje, estado: "SIN_CHOFERES_DISPONIBLES" });
  }
}

/** Al consultar ofertas, materializa vencimientos ya ocurridos y avisa al chofer. */
export class ConsultarOfertasChofer {
  constructor(private readonly ofertas: RepositorioOfertas, private readonly eventos?: PublicadorEventosTiempoReal) {}
  async ejecutar(actor: ActorAutenticado, ahora = new Date()): Promise<Oferta[]> {
    exigirRol(actor, "CHOFER", "ADMINISTRADOR");
    const ofertas = await this.ofertas.listarPorChofer(actor.idUsuario);
    const resultado: Oferta[] = [];
    for (const oferta of ofertas) {
      if (oferta.estado === "PENDIENTE" && oferta.expiraEm.getTime() <= ahora.getTime()) {
        const vencida = await this.ofertas.guardar({ ...oferta, estado: "VENCIDA", respondidaEm: new Date(ahora) });
        publicarEstadoOferta(this.eventos, vencida, "OFERTA_VENCIDA", "vigencia_vencida");
        resultado.push(vencida);
      } else resultado.push(oferta);
    }
    return resultado;
  }
}

function publicarEstadoOferta(eventos: PublicadorEventosTiempoReal | undefined, oferta: Oferta, evento: "OFERTA_VENCIDA" | "OFERTA_CANCELADA", motivo: string): void {
  try {
    eventos?.publicarAUsuario(oferta.choferId, evento, {
      id_oferta: oferta.id, id_viaje: oferta.viajeId, estado: oferta.estado.toLowerCase(), motivo,
      actualizado_en: (oferta.respondidaEm ?? new Date()).toISOString()
    });
  } catch { /* El cambio de estado persistido prevalece sobre la notificación efímera. */ }
}

export class AvanzarViaje {
  constructor(private readonly viajes: RepositorioViajes) {}

  async ejecutar(actor: ActorAutenticado, viajeId: string, estado: "CHOFER_EN_CAMINO" | "EN_CURSO", ahora = new Date()): Promise<Viaje> {
    exigirRol(actor, "CHOFER", "ADMINISTRADOR");
    const viaje = exigirViaje(await this.viajes.obtener(viajeId));
    if (viaje.choferId !== actor.idUsuario) throw new ErrorDominio("VIAJE_NO_AUTORIZADO", "El viaje no pertenece al chofer.");
    exigirTransicionViaje(viaje.estado, estado);
    return await this.viajes.guardar({ ...viaje, estado, iniciadoEm: estado === "EN_CURSO" ? new Date(ahora) : viaje.iniciadoEm });
  }
}

export class FinalizarViaje {
  constructor(
    private readonly viajes: RepositorioViajes,
    private readonly cobros: RepositorioCobros,
    private readonly asignador: AsignadorAtomico,
    private readonly ids: GeneradorId,
    private readonly pasarela?: PasarelaPagos
  ) {}

  async ejecutar(actor: ActorAutenticado, viajeId: string, ahora = new Date()): Promise<{ viaje: Viaje; cobro: Cobro }> {
    exigirRol(actor, "CHOFER", "ADMINISTRADOR");
    const viaje = exigirViaje(await this.viajes.obtener(viajeId));
    if (viaje.choferId !== actor.idUsuario) throw new ErrorDominio("VIAJE_NO_AUTORIZADO", "El viaje no pertenece al chofer.");
    const cobroExistente = await this.cobros.obtenerPorViaje(viaje.id);
    if (cobroExistente) return { viaje, cobro: cobroExistente };
    exigirTransicionViaje(viaje.estado, "FINALIZADO");
    const viajeFinalizado = await this.viajes.guardar({ ...viaje, estado: "FINALIZADO", precioFinal: viaje.precioEstimado, finalizadoEm: new Date(ahora) });
    await this.asignador.liberar(viaje.id, actor.idUsuario);
    const cobroPendiente = await this.cobros.guardar({
      id: this.ids.generar("cobro"), viajeId: viaje.id, importe: viaje.precioEstimado,
      moneda: "ARS", estado: "PENDIENTE", intentos: 0, creadoEn: new Date(ahora)
    });
    const estado = this.pasarela
      ? await this.pasarela.procesar(cobroPendiente, `finalizacion:${cobroPendiente.id}`)
      : "CONFIRMADO";
    const cobro = await this.cobros.guardar({ ...cobroPendiente, estado, intentos: cobroPendiente.intentos + 1 });
    return { viaje: viajeFinalizado, cobro };
  }
}

/** Consulta un recibo solo para los participantes del viaje o soporte. */
export class ConsultarCobro {
  constructor(private readonly viajes: RepositorioViajes, private readonly cobros: RepositorioCobros) {}

  async ejecutar(actor: ActorAutenticado, viajeId: string): Promise<Cobro> {
    const viaje = exigirViaje(await this.viajes.obtener(viajeId));
    const autorizado = (actor.rol === "PASAJERO" && viaje.pasajeroId === actor.idUsuario)
      || (actor.rol === "CHOFER" && viaje.choferId === actor.idUsuario)
      || actor.rol === "SOPORTE"
      || actor.rol === "ADMINISTRADOR";
    if (!autorizado) throw new ErrorDominio("COBRO_NO_AUTORIZADO", "El actor no puede consultar este cobro.");
    const cobro = await this.cobros.obtenerPorViaje(viaje.id);
    if (!cobro) throw new ErrorDominio("COBRO_NO_ENCONTRADO", "El viaje todavía no tiene un cobro.");
    return cobro;
  }
}

/** Reintenta únicamente cobros fallidos y guarda la respuesta por actor, operación y clave. */
export class ReintentarCobro {
  constructor(
    private readonly viajes: RepositorioViajes,
    private readonly cobros: RepositorioCobros,
    private readonly idempotencia: RepositorioIdempotencia,
    private readonly pasarela: PasarelaPagos
  ) {}

  async ejecutar(actor: ActorAutenticado, viajeId: string, clave: string): Promise<Cobro> {
    const viaje = exigirViaje(await this.viajes.obtener(viajeId));
    const autorizado = (actor.rol === "PASAJERO" && viaje.pasajeroId === actor.idUsuario)
      || actor.rol === "SOPORTE"
      || actor.rol === "ADMINISTRADOR";
    if (!autorizado) throw new ErrorDominio("COBRO_NO_AUTORIZADO", "Solo el pasajero titular o soporte puede reintentar este cobro.");
    if (!clave || clave.length > 200) throw new ErrorDominio("CLAVE_IDEMPOTENCIA_REQUERIDA", "El reintento requiere una clave de idempotencia válida.");
    if (viaje.estado !== "FINALIZADO") throw new ErrorDominio("COBRO_NO_REINTENTABLE", "El viaje debe estar finalizado para procesar el cobro.");

    const claveOperacion = `${viaje.id}:${clave}`;
    const anterior = await this.idempotencia.obtener(actor.idUsuario, claveOperacion, "reintentar_cobro") as Cobro | undefined;
    if (anterior) return anterior;

    const cobro = await this.cobros.obtenerPorViaje(viaje.id);
    if (!cobro) throw new ErrorDominio("COBRO_NO_ENCONTRADO", "El viaje todavía no tiene un cobro.");
    if (cobro.estado === "PENDIENTE") throw new ErrorDominio("COBRO_NO_REINTENTABLE", "El cobro todavía está en proceso.");
    if (cobro.estado === "CONFIRMADO") {
      await this.idempotencia.guardar(actor.idUsuario, claveOperacion, cobro, "reintentar_cobro");
      return cobro;
    }

    const estado = await this.pasarela.procesar(cobro, `reintento:${actor.idUsuario}:${viaje.id}:${clave}`);
    const actualizado = await this.cobros.guardar({ ...cobro, estado, intentos: cobro.intentos + 1 });
    await this.idempotencia.guardar(actor.idUsuario, claveOperacion, actualizado, "reintentar_cobro");
    return actualizado;
  }
}
