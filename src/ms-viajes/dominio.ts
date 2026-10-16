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

export interface Coordenada {
  latitud: number;
  longitud: number;
}

export interface EstimacionVigente {
  id: string;
  origen: Coordenada;
  destino: Coordenada;
  precioEstimado: string;
  moneda: "ARS";
  multiplicadorDemanda: number;
  factoresPrecio: Record<string, unknown>;
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

export type EstadoOferta = "PENDIENTE" | "ACEPTADA" | "RECHAZADA" | "VENCIDA";

export interface Oferta {
  id: string;
  viajeId: string;
  choferId: string;
  estado: EstadoOferta;
  enviadaEm: Date;
  expiraEm: Date;
  respondidaEm?: Date;
}

export interface Cobro {
  id: string;
  viajeId: string;
  importe: string;
  moneda: "ARS";
  estado: "CONFIRMADO";
  creadoEn: Date;
}

export interface RepositorioViajes {
  guardar(viaje: Viaje): Viaje;
  obtener(id: string): Viaje | undefined;
  listar(): Viaje[];
}

export interface RepositorioOfertas {
  guardar(oferta: Oferta): Oferta;
  obtener(id: string): Oferta | undefined;
  listarPorChofer(choferId: string): Oferta[];
}

export interface RepositorioCobros {
  guardar(cobro: Cobro): Cobro;
  obtenerPorViaje(viajeId: string): Cobro | undefined;
}

export interface RepositorioIdempotencia {
  obtener(actorId: string, clave: string): unknown | undefined;
  guardar(actorId: string, clave: string, resultado: unknown): void;
}

/** El adaptador real debe implementar esta operación dentro de una transacción. */
export interface AsignadorAtomico {
  intentarAsignar(viajeId: string, choferId: string): boolean;
  liberar(viajeId: string, choferId: string): void;
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

export class GeneradorIdMemoria implements GeneradorId {
  private secuencia = 0;

  generar(prefijo: string): string {
    this.secuencia += 1;
    return `${prefijo}-${this.secuencia}`;
  }
}

export class RepositorioViajesMemoria implements RepositorioViajes {
  private readonly datos = new Map<string, Viaje>();

  guardar(viaje: Viaje): Viaje {
    const copia = structuredClone(viaje);
    this.datos.set(viaje.id, copia);
    return structuredClone(copia);
  }

  obtener(id: string): Viaje | undefined {
    const viaje = this.datos.get(id);
    return viaje ? structuredClone(viaje) : undefined;
  }

  listar(): Viaje[] {
    return [...this.datos.values()].map((viaje) => structuredClone(viaje));
  }
}

export class RepositorioOfertasMemoria implements RepositorioOfertas {
  private readonly datos = new Map<string, Oferta>();

  guardar(oferta: Oferta): Oferta {
    const copia = structuredClone(oferta);
    this.datos.set(oferta.id, copia);
    return structuredClone(copia);
  }

  obtener(id: string): Oferta | undefined {
    const oferta = this.datos.get(id);
    return oferta ? structuredClone(oferta) : undefined;
  }

  listarPorChofer(choferId: string): Oferta[] {
    return [...this.datos.values()].filter((oferta) => oferta.choferId === choferId).map((oferta) => structuredClone(oferta));
  }
}

export class RepositorioCobrosMemoria implements RepositorioCobros {
  private readonly datos = new Map<string, Cobro>();

  guardar(cobro: Cobro): Cobro {
    const copia = structuredClone(cobro);
    this.datos.set(cobro.viajeId, copia);
    return structuredClone(copia);
  }

  obtenerPorViaje(viajeId: string): Cobro | undefined {
    const cobro = this.datos.get(viajeId);
    return cobro ? structuredClone(cobro) : undefined;
  }
}

export class RepositorioIdempotenciaMemoria implements RepositorioIdempotencia {
  private readonly datos = new Map<string, unknown>();

  obtener(actorId: string, clave: string): unknown | undefined {
    return structuredClone(this.datos.get(`${actorId}:${clave}`));
  }

  guardar(actorId: string, clave: string, resultado: unknown): void {
    this.datos.set(`${actorId}:${clave}`, structuredClone(resultado));
  }
}

export class AsignadorAtomicoMemoria implements AsignadorAtomico {
  private readonly porViaje = new Map<string, string>();
  private readonly porChofer = new Map<string, string>();

  intentarAsignar(viajeId: string, choferId: string): boolean {
    if (this.porViaje.has(viajeId) || this.porChofer.has(choferId)) return false;
    this.porViaje.set(viajeId, choferId);
    this.porChofer.set(choferId, viajeId);
    return true;
  }

  liberar(viajeId: string, choferId: string): void {
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
  constructor(
    private readonly viajes: RepositorioViajes,
    private readonly idempotencia: RepositorioIdempotencia,
    private readonly ids: GeneradorId
  ) {}

  ejecutar(actor: ActorAutenticado, estimacion: EstimacionVigente, clave: string, ahora = new Date()): Viaje {
    exigirRol(actor, "PASAJERO");
    if (!clave) throw new ErrorDominio("CLAVE_IDEMPOTENCIA_REQUERIDA", "La confirmacion requiere una clave de idempotencia.");
    const anterior = this.idempotencia.obtener(actor.idUsuario, clave) as Viaje | undefined;
    if (anterior) return anterior;
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
      factoresPrecio: structuredClone(estimacion.factoresPrecio),
      estado: "SOLICITADO",
      creadoEn: new Date(ahora)
    };
    const guardado = this.viajes.guardar(viaje);
    this.idempotencia.guardar(actor.idUsuario, clave, guardado);
    return guardado;
  }
}

export class CrearOferta {
  constructor(private readonly ofertas: RepositorioOfertas, private readonly viajes: RepositorioViajes, private readonly ids: GeneradorId) {}

  ejecutar(actor: ActorAutenticado, viajeId: string, choferId: string, expiraEn: Date, ahora = new Date()): Oferta {
    exigirRol(actor, "SOPORTE", "ADMINISTRADOR");
    const viaje = exigirViaje(this.viajes.obtener(viajeId));
    if (viaje.estado !== "SOLICITADO") throw new ErrorDominio("VIAJE_NO_OFERTABLE", "El viaje no admite nuevas ofertas.");
    if (expiraEn.getTime() <= ahora.getTime()) throw new ErrorDominio("OFERTA_INVALIDA", "La oferta debe vencer en el futuro.");
    return this.ofertas.guardar({ id: this.ids.generar("oferta"), viajeId, choferId, estado: "PENDIENTE", enviadaEm: new Date(ahora), expiraEm: new Date(expiraEn) });
  }
}

export class AceptarOferta {
  constructor(private readonly ofertas: RepositorioOfertas, private readonly viajes: RepositorioViajes, private readonly asignador: AsignadorAtomico) {}

  ejecutar(actor: ActorAutenticado, ofertaId: string, ahora = new Date()): Viaje {
    exigirRol(actor, "CHOFER");
    const oferta = this.ofertas.obtener(ofertaId);
    if (!oferta) throw new ErrorDominio("OFERTA_NO_ENCONTRADA", "La oferta no existe.");
    if (oferta.choferId !== actor.idUsuario) throw new ErrorDominio("OFERTA_NO_AUTORIZADA", "La oferta no pertenece al chofer.");
    if (oferta.estado !== "PENDIENTE") throw new ErrorDominio("OFERTA_NO_DISPONIBLE", "La oferta ya fue respondida.");
    if (oferta.expiraEm.getTime() <= ahora.getTime()) {
      this.ofertas.guardar({ ...oferta, estado: "VENCIDA", respondidaEm: new Date(ahora) });
      throw new ErrorDominio("OFERTA_VENCIDA", "La oferta ya vencio.");
    }
    const viaje = exigirViaje(this.viajes.obtener(oferta.viajeId));
    if (viaje.estado !== "SOLICITADO") throw new ErrorDominio("VIAJE_NO_DISPONIBLE", "El viaje ya no esta disponible.");
    if (!this.asignador.intentarAsignar(viaje.id, actor.idUsuario)) throw new ErrorDominio("ASIGNACION_EN_CONFLICTO", "El viaje o el chofer ya fueron asignados.");
    const actualizado = this.viajes.guardar({ ...viaje, choferId: actor.idUsuario, estado: "ASIGNADO" });
    this.ofertas.guardar({ ...oferta, estado: "ACEPTADA", respondidaEm: new Date(ahora) });
    return actualizado;
  }
}

export class RechazarOferta {
  constructor(private readonly ofertas: RepositorioOfertas) {}

  ejecutar(actor: ActorAutenticado, ofertaId: string, ahora = new Date()): Oferta {
    exigirRol(actor, "CHOFER");
    const oferta = this.ofertas.obtener(ofertaId);
    if (!oferta) throw new ErrorDominio("OFERTA_NO_ENCONTRADA", "La oferta no existe.");
    if (oferta.choferId !== actor.idUsuario) throw new ErrorDominio("OFERTA_NO_AUTORIZADA", "La oferta no pertenece al chofer.");
    if (oferta.estado !== "PENDIENTE") throw new ErrorDominio("OFERTA_NO_DISPONIBLE", "La oferta ya fue respondida.");
    return this.ofertas.guardar({ ...oferta, estado: "RECHAZADA", respondidaEm: new Date(ahora) });
  }
}

export class ConsultarViaje {
  constructor(private readonly viajes: RepositorioViajes) {}

  ejecutar(actor: ActorAutenticado, viajeId: string): Viaje {
    const viaje = exigirViaje(this.viajes.obtener(viajeId));
    const autorizado = viaje.pasajeroId === actor.idUsuario || viaje.choferId === actor.idUsuario || actor.rol === "SOPORTE" || actor.rol === "ADMINISTRADOR";
    if (!autorizado) throw new ErrorDominio("VIAJE_NO_AUTORIZADO", "El actor no puede consultar este viaje.");
    return viaje;
  }
}

export class CancelarViaje {
  constructor(private readonly viajes: RepositorioViajes, private readonly asignador: AsignadorAtomico) {}

  ejecutar(actor: ActorAutenticado, viajeId: string, motivo: string, ahora = new Date()): Viaje {
    const viaje = exigirViaje(this.viajes.obtener(viajeId));
    const estado = actor.rol === "PASAJERO" ? "CANCELADO_POR_PASAJERO" : actor.rol === "CHOFER" ? "CANCELADO_POR_CHOFER" : actor.rol === "SOPORTE" || actor.rol === "ADMINISTRADOR" ? "CANCELADO_POR_OPERADOR" : undefined;
    if (!estado || (actor.rol === "PASAJERO" && viaje.pasajeroId !== actor.idUsuario) || (actor.rol === "CHOFER" && viaje.choferId !== actor.idUsuario)) throw new ErrorDominio("VIAJE_NO_AUTORIZADO", "El actor no puede cancelar este viaje.");
    if (["FINALIZADO", "CANCELADO_POR_PASAJERO", "CANCELADO_POR_CHOFER", "CANCELADO_POR_OPERADOR"].includes(viaje.estado)) throw new ErrorDominio("VIAJE_TERMINAL", "El viaje ya termino.");
    if (viaje.choferId) this.asignador.liberar(viaje.id, viaje.choferId);
    return this.viajes.guardar({ ...viaje, estado, motivoCancelacion: motivo, canceladoEm: new Date(ahora) });
  }
}

export class AvanzarViaje {
  constructor(private readonly viajes: RepositorioViajes) {}

  ejecutar(actor: ActorAutenticado, viajeId: string, estado: "CHOFER_EN_CAMINO" | "EN_CURSO", ahora = new Date()): Viaje {
    exigirRol(actor, "CHOFER");
    const viaje = exigirViaje(this.viajes.obtener(viajeId));
    if (viaje.choferId !== actor.idUsuario) throw new ErrorDominio("VIAJE_NO_AUTORIZADO", "El viaje no pertenece al chofer.");
    const valido = (viaje.estado === "ASIGNADO" && estado === "CHOFER_EN_CAMINO") || (viaje.estado === "CHOFER_EN_CAMINO" && estado === "EN_CURSO");
    if (!valido) throw new ErrorDominio("TRANSICION_INVALIDA", "La transicion solicitada no es valida.");
    return this.viajes.guardar({ ...viaje, estado, iniciadoEm: estado === "EN_CURSO" ? new Date(ahora) : viaje.iniciadoEm });
  }
}

export class FinalizarViaje {
  constructor(private readonly viajes: RepositorioViajes, private readonly cobros: RepositorioCobros, private readonly asignador: AsignadorAtomico, private readonly ids: GeneradorId) {}

  ejecutar(actor: ActorAutenticado, viajeId: string, ahora = new Date()): { viaje: Viaje; cobro: Cobro } {
    exigirRol(actor, "CHOFER");
    const viaje = exigirViaje(this.viajes.obtener(viajeId));
    if (viaje.choferId !== actor.idUsuario) throw new ErrorDominio("VIAJE_NO_AUTORIZADO", "El viaje no pertenece al chofer.");
    const cobroExistente = this.cobros.obtenerPorViaje(viaje.id);
    if (cobroExistente) return { viaje, cobro: cobroExistente };
    if (viaje.estado !== "EN_CURSO") throw new ErrorDominio("TRANSICION_INVALIDA", "Solo se puede finalizar un viaje en curso.");
    const viajeFinalizado = this.viajes.guardar({ ...viaje, estado: "FINALIZADO", precioFinal: viaje.precioEstimado, finalizadoEm: new Date(ahora) });
    this.asignador.liberar(viaje.id, actor.idUsuario);
    const cobro = this.cobros.guardar({ id: this.ids.generar("cobro"), viajeId: viaje.id, importe: viaje.precioEstimado, moneda: "ARS", estado: "CONFIRMADO", creadoEn: new Date(ahora) });
    return { viaje: viajeFinalizado, cobro };
  }
}
