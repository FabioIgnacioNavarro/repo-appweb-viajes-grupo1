export type Rol = "PASAJERO" | "CHOFER" | "SOPORTE" | "ADMINISTRADOR";

export interface ActorAutenticado { idUsuario: string; rol: Rol; }
export interface Coordenada { latitud: number; longitud: number; }

export interface Chofer {
  id: string; usuarioId: string; habilitado: boolean; disponibilidad: boolean;
  carnetConducirValidado: boolean; fechaCreacion: Date; fechaActualizacion: Date;
}

export interface Vehiculo {
  id: string; patente: string; tipoVehiculo: string; marca: string; modelo: string;
  anioFabricacion: number; color: string; capacidadPasajeros: number;
  estado: "ACTIVO" | "INACTIVO"; createdAt: Date; updatedAt: Date;
}

export interface AsignacionVehiculo {
  id: string; usuarioChoferId: string; vehiculoId: string;
  estadoAsignacion: "ACTIVA" | "INACTIVA"; asignadoAt: Date; desasignadoAt?: Date;
}

export interface UbicacionActual {
  id: string; usuarioId: string; latitud: number; longitud: number;
  actualizadoAt: Date; precisionMetros?: number;
}

export interface UbicacionHistorica {
  id: string; usuarioId: string; viajeId?: string; latitud: number; longitud: number;
  registradoAt: Date; precisionMetros?: number;
}

export interface ChoferCercano extends UbicacionActual { distanciaMetros: number; }

export interface RepositorioChoferes {
  obtenerPorUsuario(usuarioId: string): Promise<Chofer | undefined>;
  guardar(chofer: Chofer): Promise<Chofer>;
  listarTodos?(): Promise<Chofer[]>;
  buscarDisponiblesCercanos(origen: Coordenada, radioMetros: number, ahora: Date, antiguedadMaximaMs: number): Promise<ChoferCercano[]>;
}

export interface RepositorioVehiculos {
  guardar(vehiculo: Vehiculo): Promise<Vehiculo>;
  obtener(id: string): Promise<Vehiculo | undefined>;
  obtenerPorPatente(patente: string): Promise<Vehiculo | undefined>;
  listar(): Promise<Vehiculo[]>;
  asignarAChofer(usuarioChoferId: string, vehiculoId: string, asignacionId: string, ahora: Date): Promise<AsignacionVehiculo>;
  obtenerVehiculoActivoDeChofer(usuarioChoferId: string): Promise<Vehiculo | undefined>;
}

export interface RepositorioUbicaciones {
  obtenerActual(usuarioId: string): Promise<UbicacionActual | undefined>;
  guardarSiEsMasNueva(ubicacion: UbicacionActual): Promise<UbicacionActual>;
  registrarHistoricaSiCorresponde?(ubicacion: UbicacionActual, intervaloMinimoMs?: number, viajeId?: string): Promise<boolean>;
  eliminarHistoricasAnterioresA?(limite: Date): Promise<number>;
}

export interface RepositorioViajesActivos { buscarChoferesOcupados(idsChoferes: string[]): Promise<Set<string>>; }
export interface AutorizadorUbicacion { puedeConsultarUbicacion(actor: ActorAutenticado, choferUsuarioId: string): Promise<boolean>; }

export class ErrorFlota extends Error {
  constructor(public readonly codigo: string, mensaje: string) { super(mensaje); this.name = "ErrorFlota"; }
}

export function validarCoordenada(coordenada: Coordenada): void {
  if (!Number.isFinite(coordenada.latitud) || coordenada.latitud < -90 || coordenada.latitud > 90) throw new ErrorFlota("COORDENADAS_INVALIDAS", "La latitud debe estar entre -90 y 90.");
  if (!Number.isFinite(coordenada.longitud) || coordenada.longitud < -180 || coordenada.longitud > 180) throw new ErrorFlota("COORDENADAS_INVALIDAS", "La longitud debe estar entre -180 y 180.");
}

export function distanciaHaversineMetros(origen: Coordenada, destino: Coordenada): number {
  const radioTierra = 6_371_000;
  const latitud = (destino.latitud - origen.latitud) * Math.PI / 180;
  const longitud = (destino.longitud - origen.longitud) * Math.PI / 180;
  const origenLatitud = origen.latitud * Math.PI / 180;
  const destinoLatitud = destino.latitud * Math.PI / 180;
  const a = Math.sin(latitud / 2) ** 2 + Math.cos(origenLatitud) * Math.cos(destinoLatitud) * Math.sin(longitud / 2) ** 2;
  return 2 * radioTierra * Math.asin(Math.sqrt(a));
}

function exigirChofer(actor: ActorAutenticado): void {
  if (actor.rol !== "CHOFER" && actor.rol !== "ADMINISTRADOR") {
    throw new ErrorFlota("ROL_NO_AUTORIZADO", "Solo un chofer o administrador puede ejecutar esta operación.");
  }
}
function exigirChoferExistente(chofer: Chofer | undefined): Chofer {
  if (!chofer) throw new ErrorFlota("CHOFER_NO_ENCONTRADO", "El perfil de chofer no existe.");
  return chofer;
}
async function obtenerOHabilitarChofer(choferes: RepositorioChoferes, actor: ActorAutenticado, ahora: Date): Promise<Chofer> {
  const existente = await choferes.obtenerPorUsuario(actor.idUsuario);
  if (existente) return existente;
  if (actor.rol === "ADMINISTRADOR") {
    return choferes.guardar({
      id: actor.idUsuario,
      usuarioId: actor.idUsuario,
      habilitado: true,
      disponibilidad: false,
      carnetConducirValidado: true,
      fechaCreacion: new Date(ahora),
      fechaActualizacion: new Date(ahora),
    });
  }
  return exigirChoferExistente(undefined);
}

export class CambiarDisponibilidadChofer {
  constructor(private readonly choferes: RepositorioChoferes, private readonly vehiculos?: RepositorioVehiculos) {}
  async ejecutar(actor: ActorAutenticado, disponibilidad: boolean, ahora = new Date()): Promise<Chofer> {
    exigirChofer(actor);
    const chofer = await obtenerOHabilitarChofer(this.choferes, actor, ahora);
    if (!chofer.habilitado || !chofer.carnetConducirValidado) throw new ErrorFlota("CHOFER_NO_HABILITADO", "El chofer no está habilitado para operar.");
    if (disponibilidad && actor.rol === "CHOFER" && this.vehiculos) {
      const activo = await this.vehiculos.obtenerVehiculoActivoDeChofer(chofer.id);
      if (!activo) throw new ErrorFlota("CHOFER_SIN_VEHICULO_ACTIVO", "El chofer no tiene un vehículo activo asignado.");
    }
    return this.choferes.guardar({ ...chofer, disponibilidad, fechaActualizacion: new Date(ahora) });
  }
}

export class RegistrarUbicacionActual {
  constructor(private readonly choferes: RepositorioChoferes, private readonly ubicaciones: RepositorioUbicaciones, private readonly id: () => string) {}
  async ejecutar(actor: ActorAutenticado, coordenada: Coordenada, actualizadoAt = new Date(), precisionMetros?: number): Promise<UbicacionActual> {
    exigirChofer(actor); validarCoordenada(coordenada);
    const chofer = await obtenerOHabilitarChofer(this.choferes, actor, actualizadoAt);
    if (!chofer.habilitado || !chofer.carnetConducirValidado) throw new ErrorFlota("CHOFER_NO_HABILITADO", "El chofer no está habilitado para informar ubicación.");
    if (Number.isNaN(actualizadoAt.getTime())) throw new ErrorFlota("FECHA_INVALIDA", "La fecha de ubicación no es válida.");
    if (precisionMetros !== undefined && (!Number.isFinite(precisionMetros) || precisionMetros < 0)) throw new ErrorFlota("PRECISION_INVALIDA", "La precisión debe ser un número positivo.");
    const guardada = await this.ubicaciones.guardarSiEsMasNueva({ id: this.id(), usuarioId: actor.idUsuario, ...coordenada, actualizadoAt: new Date(actualizadoAt), precisionMetros });
    await this.ubicaciones.registrarHistoricaSiCorresponde?.(guardada, 15_000);
    return guardada;
  }
}

export class BuscarChoferesCercanos {
  constructor(private readonly choferes: RepositorioChoferes, private readonly viajes: RepositorioViajesActivos) {}
  async ejecutar(actor: ActorAutenticado, origen: Coordenada, radioMetros: number, ahora = new Date(), antiguedadMaximaMs = 30_000): Promise<ChoferCercano[]> {
    if (!["PASAJERO", "SOPORTE", "ADMINISTRADOR"].includes(actor.rol)) throw new ErrorFlota("ROL_NO_AUTORIZADO", "El rol no puede buscar choferes.");
    validarCoordenada(origen);
    if (!Number.isFinite(radioMetros) || radioMetros <= 0 || radioMetros > 100_000) throw new ErrorFlota("RADIO_INVALIDO", "El radio debe estar entre 1 y 100000 metros.");
    const candidatos = await this.choferes.buscarDisponiblesCercanos(origen, radioMetros, ahora, antiguedadMaximaMs);
    const idsOcupados = await this.viajes.buscarChoferesOcupados(candidatos.map((chofer) => chofer.usuarioId));
    return candidatos.filter((chofer) => !idsOcupados.has(chofer.usuarioId));
  }
}

export class ConsultarUbicacionChofer {
  constructor(private readonly choferes: RepositorioChoferes, private readonly ubicaciones: RepositorioUbicaciones, private readonly autorizador: AutorizadorUbicacion) {}
  async ejecutar(actor: ActorAutenticado, choferUsuarioId: string): Promise<{ chofer: Chofer; ubicacion?: UbicacionActual }> {
    const chofer = exigirChoferExistente(await this.choferes.obtenerPorUsuario(choferUsuarioId));
    if (!await this.autorizador.puedeConsultarUbicacion(actor, choferUsuarioId)) throw new ErrorFlota("UBICACION_NO_AUTORIZADA", "No tenés autorización para consultar la ubicación de este chofer.");
    return { chofer, ubicacion: await this.ubicaciones.obtenerActual(chofer.usuarioId) };
  }
}

export class RepositorioChoferesMemoria implements RepositorioChoferes {
  private readonly datos = new Map<string, Chofer>();
  constructor(private readonly ubicaciones = new Map<string, UbicacionActual>()) {}
  async guardar(chofer: Chofer): Promise<Chofer> { const copia = structuredClone(chofer); this.datos.set(chofer.usuarioId, copia); return structuredClone(copia); }
  async obtenerPorUsuario(usuarioId: string): Promise<Chofer | undefined> { const chofer = this.datos.get(usuarioId); return chofer ? structuredClone(chofer) : undefined; }
  async listarTodos(): Promise<Chofer[]> { return [...this.datos.values()].sort((a, b) => a.fechaCreacion.getTime() - b.fechaCreacion.getTime()).map((c) => structuredClone(c)); }
  guardarUbicacion(ubicacion: UbicacionActual): UbicacionActual { const anterior = this.ubicaciones.get(ubicacion.usuarioId); if (anterior && anterior.actualizadoAt.getTime() > ubicacion.actualizadoAt.getTime()) return structuredClone(anterior); const copia = structuredClone(ubicacion); this.ubicaciones.set(ubicacion.usuarioId, copia); return structuredClone(copia); }
  obtenerUbicacion(usuarioId: string): UbicacionActual | undefined { const ubicacion = this.ubicaciones.get(usuarioId); return ubicacion ? structuredClone(ubicacion) : undefined; }
  async buscarDisponiblesCercanos(origen: Coordenada, radioMetros: number, ahora: Date, antiguedadMaximaMs: number): Promise<ChoferCercano[]> {
    return [...this.datos.values()].flatMap((chofer) => {
      if (!chofer.habilitado || !chofer.disponibilidad || !chofer.carnetConducirValidado) return [];
      const ubicacion = this.ubicaciones.get(chofer.usuarioId);
      if (!ubicacion || ahora.getTime() - ubicacion.actualizadoAt.getTime() > antiguedadMaximaMs) return [];
      const distanciaMetros = distanciaHaversineMetros(origen, ubicacion);
      return distanciaMetros <= radioMetros ? [{ ...structuredClone(ubicacion), distanciaMetros }] : [];
    }).sort((a, b) => a.distanciaMetros - b.distanciaMetros);
  }
}

export class RepositorioUbicacionesMemoria implements RepositorioUbicaciones {
  private historicas: UbicacionHistorica[] = [];
  constructor(private readonly ubicaciones = new Map<string, UbicacionActual>()) {}
  async obtenerActual(usuarioId: string): Promise<UbicacionActual | undefined> { const ubicacion = this.ubicaciones.get(usuarioId); return ubicacion ? structuredClone(ubicacion) : undefined; }
  async guardarSiEsMasNueva(ubicacion: UbicacionActual): Promise<UbicacionActual> { const anterior = this.ubicaciones.get(ubicacion.usuarioId); if (anterior && anterior.actualizadoAt.getTime() >= ubicacion.actualizadoAt.getTime()) return structuredClone(anterior); const copia = structuredClone(ubicacion); this.ubicaciones.set(ubicacion.usuarioId, copia); return structuredClone(copia); }
  async registrarHistoricaSiCorresponde(ubicacion: UbicacionActual, intervaloMinimoMs = 15_000, viajeId?: string): Promise<boolean> {
    const ultimas = this.historicas.filter((h) => h.usuarioId === ubicacion.usuarioId);
    const ultima = ultimas.at(-1);
    if (ultima && ubicacion.actualizadoAt.getTime() - ultima.registradoAt.getTime() < intervaloMinimoMs) return false;
    this.historicas.push({
      id: `${ubicacion.id}-hist-${this.historicas.length + 1}`,
      usuarioId: ubicacion.usuarioId,
      viajeId,
      latitud: ubicacion.latitud,
      longitud: ubicacion.longitud,
      registradoAt: new Date(ubicacion.actualizadoAt),
      precisionMetros: ubicacion.precisionMetros,
    });
    return true;
  }
  async eliminarHistoricasAnterioresA(limite: Date): Promise<number> {
    const antes = this.historicas.length;
    this.historicas = this.historicas.filter((h) => h.registradoAt.getTime() >= limite.getTime());
    return antes - this.historicas.length;
  }
  listarHistoricas(usuarioId?: string): UbicacionHistorica[] {
    return this.historicas.filter((h) => !usuarioId || h.usuarioId === usuarioId).map((h) => structuredClone(h));
  }
}

export class RepositorioVehiculosMemoria implements RepositorioVehiculos {
  private readonly vehiculos = new Map<string, Vehiculo>();
  private readonly asignaciones: AsignacionVehiculo[] = [];

  async guardar(vehiculo: Vehiculo): Promise<Vehiculo> {
    const copia = structuredClone(vehiculo);
    this.vehiculos.set(vehiculo.id, copia);
    return structuredClone(copia);
  }
  async obtener(id: string): Promise<Vehiculo | undefined> {
    const encontrado = this.vehiculos.get(id);
    return encontrado ? structuredClone(encontrado) : undefined;
  }
  async obtenerPorPatente(patente: string): Promise<Vehiculo | undefined> {
    const normalizada = patente.trim().toUpperCase();
    const encontrado = [...this.vehiculos.values()].find((v) => v.patente === normalizada);
    return encontrado ? structuredClone(encontrado) : undefined;
  }
  async listar(): Promise<Vehiculo[]> {
    return [...this.vehiculos.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((v) => structuredClone(v));
  }
  async asignarAChofer(usuarioChoferId: string, vehiculoId: string, asignacionId: string, ahora: Date): Promise<AsignacionVehiculo> {
    for (const item of this.asignaciones) {
      if (item.usuarioChoferId === usuarioChoferId && item.estadoAsignacion === "ACTIVA") {
        item.estadoAsignacion = "INACTIVA";
        item.desasignadoAt = new Date(ahora);
      }
    }
    const nueva: AsignacionVehiculo = { id: asignacionId, usuarioChoferId, vehiculoId, estadoAsignacion: "ACTIVA", asignadoAt: new Date(ahora) };
    this.asignaciones.push(nueva);
    return structuredClone(nueva);
  }
  async obtenerVehiculoActivoDeChofer(usuarioChoferId: string): Promise<Vehiculo | undefined> {
    const activa = this.asignaciones.find((a) => a.usuarioChoferId === usuarioChoferId && a.estadoAsignacion === "ACTIVA");
    if (!activa) return undefined;
    return this.obtener(activa.vehiculoId);
  }
}

export class RegistrarChofer {
  constructor(private readonly choferes: RepositorioChoferes, private readonly id: () => string) {}
  async ejecutar(actor: ActorAutenticado, entrada: { usuarioId?: string; carnetConducirValidado?: boolean; habilitado?: boolean } = {}, ahora = new Date()): Promise<Chofer> {
    exigirChofer(actor);
    const objetivoUsuarioId = actor.rol === "ADMINISTRADOR" && entrada.usuarioId?.trim() ? entrada.usuarioId.trim() : actor.idUsuario;
    const existente = await this.choferes.obtenerPorUsuario(objetivoUsuarioId);
    if (existente) throw new ErrorFlota("CHOFER_YA_EXISTE", "El chofer ya se encuentra registrado en flota.");
    const esAdmin = actor.rol === "ADMINISTRADOR";
    return this.choferes.guardar({
      id: this.id(),
      usuarioId: objetivoUsuarioId,
      habilitado: esAdmin ? Boolean(entrada.habilitado ?? false) : false,
      disponibilidad: false,
      carnetConducirValidado: esAdmin ? Boolean(entrada.carnetConducirValidado ?? false) : Boolean(entrada.carnetConducirValidado ?? false),
      fechaCreacion: new Date(ahora),
      fechaActualizacion: new Date(ahora),
    });
  }
}

export class HabilitarChofer {
  constructor(private readonly choferes: RepositorioChoferes) {}
  async ejecutar(actor: ActorAutenticado, choferUsuarioId: string, entrada: { habilitado: boolean; carnetConducirValidado?: boolean }, ahora = new Date()): Promise<Chofer> {
    if (actor.rol !== "ADMINISTRADOR") throw new ErrorFlota("ROL_NO_AUTORIZADO", "Solo administración puede habilitar choferes.");
    const chofer = exigirChoferExistente(await this.choferes.obtenerPorUsuario(choferUsuarioId));
    const carnetValidado = entrada.carnetConducirValidado ?? chofer.carnetConducirValidado;
    const habilitado = Boolean(entrada.habilitado);
    return this.choferes.guardar({
      ...chofer,
      habilitado,
      carnetConducirValidado: carnetValidado,
      disponibilidad: habilitado && carnetValidado ? chofer.disponibilidad : false,
      fechaActualizacion: new Date(ahora),
    });
  }
}

export class RegistrarVehiculo {
  constructor(private readonly vehiculos: RepositorioVehiculos, private readonly id: () => string) {}
  async ejecutar(
    actor: ActorAutenticado,
    entrada: { patente: string; tipoVehiculo: string; marca: string; modelo: string; anioFabricacion: number; color: string; capacidadPasajeros: number },
    ahora = new Date()
  ): Promise<Vehiculo> {
    exigirChofer(actor);
    const patente = entrada.patente.trim().toUpperCase();
    const tipoVehiculo = entrada.tipoVehiculo.trim().toUpperCase();
    const marca = entrada.marca.trim();
    const modelo = entrada.modelo.trim();
    const color = entrada.color.trim();
    if (!patente || patente.length < 5 || patente.length > 15 || !tipoVehiculo || !marca || !modelo || !color) {
      throw new ErrorFlota("VEHICULO_INVALIDO", "Patente, tipo, marca, modelo y color son obligatorios.");
    }
    if (!Number.isInteger(entrada.anioFabricacion) || entrada.anioFabricacion < 1990 || entrada.anioFabricacion > 2035) {
      throw new ErrorFlota("VEHICULO_INVALIDO", "El año de fabricación del vehículo no es válido.");
    }
    if (!Number.isInteger(entrada.capacidadPasajeros) || entrada.capacidadPasajeros < 1 || entrada.capacidadPasajeros > 20) {
      throw new ErrorFlota("VEHICULO_INVALIDO", "La capacidad de pasajeros debe estar entre 1 y 20.");
    }
    if (await this.vehiculos.obtenerPorPatente(patente)) {
      throw new ErrorFlota("VEHICULO_YA_EXISTE", "Ya existe un vehículo registrado con esa patente.");
    }
    return this.vehiculos.guardar({
      id: this.id(), patente, tipoVehiculo, marca, modelo,
      anioFabricacion: entrada.anioFabricacion, color, capacidadPasajeros: entrada.capacidadPasajeros,
      estado: "ACTIVO", createdAt: new Date(ahora), updatedAt: new Date(ahora),
    });
  }
}

export class AsignarVehiculoAChofer {
  constructor(private readonly choferes: RepositorioChoferes, private readonly vehiculos: RepositorioVehiculos, private readonly id: () => string) {}
  async ejecutar(actor: ActorAutenticado, choferUsuarioId: string, vehiculoId: string, ahora = new Date()): Promise<{ chofer: Chofer; vehiculo: Vehiculo; asignacion: AsignacionVehiculo }> {
    if (actor.rol !== "ADMINISTRADOR") throw new ErrorFlota("ROL_NO_AUTORIZADO", "Solo administración puede asignar vehículos.");
    const chofer = exigirChoferExistente(await this.choferes.obtenerPorUsuario(choferUsuarioId));
    const vehiculo = await this.vehiculos.obtener(vehiculoId);
    if (!vehiculo) throw new ErrorFlota("VEHICULO_NO_ENCONTRADO", "El vehículo especificado no existe.");
    if (vehiculo.estado !== "ACTIVO") throw new ErrorFlota("VEHICULO_INACTIVO", "El vehículo no está activo.");
    const asignacion = await this.vehiculos.asignarAChofer(chofer.id, vehiculo.id, this.id(), ahora);
    return { chofer, vehiculo, asignacion };
  }
}

export class ListarChoferesFlota {
  constructor(private readonly choferes: RepositorioChoferes, private readonly vehiculos?: RepositorioVehiculos) {}
  async ejecutar(actor: ActorAutenticado): Promise<Array<{ chofer: Chofer; vehiculoActivo?: Vehiculo }>> {
    if (actor.rol !== "ADMINISTRADOR" && actor.rol !== "SOPORTE") {
      throw new ErrorFlota("ROL_NO_AUTORIZADO", "Solo administración o soporte puede listar los choferes.");
    }
    const lista = this.choferes.listarTodos ? await this.choferes.listarTodos() : [];
    return Promise.all(lista.map(async (chofer) => ({
      chofer,
      vehiculoActivo: await this.vehiculos?.obtenerVehiculoActivoDeChofer(chofer.id),
    })));
  }
}

export class ListarVehiculosFlota {
  constructor(private readonly vehiculos: RepositorioVehiculos) {}
  async ejecutar(actor: ActorAutenticado): Promise<Vehiculo[]> {
    if (!["ADMINISTRADOR", "SOPORTE", "CHOFER"].includes(actor.rol)) {
      throw new ErrorFlota("ROL_NO_AUTORIZADO", "Rol no autorizado para listar vehículos.");
    }
    return this.vehiculos.listar();
  }
}

/** Aplica la política de retención del ADR 0010 eliminando ubicaciones históricas vencidas (> 60 días). */
export class PurgarUbicacionesHistoricasVencidas {
  constructor(private readonly ubicaciones: RepositorioUbicaciones, private readonly diasRetencion = 60) {
    if (!Number.isFinite(diasRetencion) || diasRetencion <= 0) throw new ErrorFlota("ENTRADA_INVALIDA", "Los días de retención deben ser mayores a cero.");
  }
  async ejecutar(ahora = new Date()): Promise<{ eliminados: number; fechaCorte: Date }> {
    const fechaCorte = new Date(ahora.getTime() - this.diasRetencion * 24 * 60 * 60 * 1000);
    const eliminados = await this.ubicaciones.eliminarHistoricasAnterioresA?.(fechaCorte) ?? 0;
    return { eliminados, fechaCorte };
  }
}

export class RepositorioViajesActivosMemoria implements RepositorioViajesActivos {
  private readonly activos = new Set<string>();
  marcarActivo(choferUsuarioId: string): void { this.activos.add(choferUsuarioId); }
  liberar(choferUsuarioId: string): void { this.activos.delete(choferUsuarioId); }
  async buscarChoferesOcupados(idsChoferes: string[]): Promise<Set<string>> { return new Set(idsChoferes.filter((id) => this.activos.has(id))); }
}

export class AutorizadorUbicacionBasico implements AutorizadorUbicacion {
  async puedeConsultarUbicacion(actor: ActorAutenticado, choferUsuarioId: string): Promise<boolean> { return actor.idUsuario === choferUsuarioId || actor.rol === "SOPORTE" || actor.rol === "ADMINISTRADOR"; }
}
