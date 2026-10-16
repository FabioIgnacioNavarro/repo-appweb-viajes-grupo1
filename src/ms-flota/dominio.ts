export type Rol = "PASAJERO" | "CHOFER" | "SOPORTE" | "ADMINISTRADOR";

export interface ActorAutenticado { idUsuario: string; rol: Rol; }
export interface Coordenada { latitud: number; longitud: number; }

export interface Chofer {
  id: string; usuarioId: string; habilitado: boolean; disponibilidad: boolean;
  carnetConducirValidado: boolean; fechaCreacion: Date; fechaActualizacion: Date;
}

export interface UbicacionActual {
  id: string; usuarioId: string; latitud: number; longitud: number;
  actualizadoAt: Date; precisionMetros?: number;
}

export interface ChoferCercano extends UbicacionActual { distanciaMetros: number; }

export interface RepositorioChoferes {
  obtenerPorUsuario(usuarioId: string): Promise<Chofer | undefined>;
  guardar(chofer: Chofer): Promise<Chofer>;
  buscarDisponiblesCercanos(origen: Coordenada, radioMetros: number, ahora: Date, antiguedadMaximaMs: number): Promise<ChoferCercano[]>;
}

export interface RepositorioUbicaciones {
  obtenerActual(usuarioId: string): Promise<UbicacionActual | undefined>;
  guardarSiEsMasNueva(ubicacion: UbicacionActual): Promise<UbicacionActual>;
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
  if (actor.rol !== "CHOFER") throw new ErrorFlota("ROL_NO_AUTORIZADO", "Solo un chofer puede ejecutar esta operación.");
}
function exigirChoferExistente(chofer: Chofer | undefined): Chofer {
  if (!chofer) throw new ErrorFlota("CHOFER_NO_ENCONTRADO", "El perfil de chofer no existe.");
  return chofer;
}

export class CambiarDisponibilidadChofer {
  constructor(private readonly choferes: RepositorioChoferes) {}
  async ejecutar(actor: ActorAutenticado, disponibilidad: boolean, ahora = new Date()): Promise<Chofer> {
    exigirChofer(actor);
    const chofer = exigirChoferExistente(await this.choferes.obtenerPorUsuario(actor.idUsuario));
    if (!chofer.habilitado || !chofer.carnetConducirValidado) throw new ErrorFlota("CHOFER_NO_HABILITADO", "El chofer no está habilitado para operar.");
    return this.choferes.guardar({ ...chofer, disponibilidad, fechaActualizacion: new Date(ahora) });
  }
}

export class RegistrarUbicacionActual {
  constructor(private readonly choferes: RepositorioChoferes, private readonly ubicaciones: RepositorioUbicaciones, private readonly id: () => string) {}
  async ejecutar(actor: ActorAutenticado, coordenada: Coordenada, actualizadoAt = new Date(), precisionMetros?: number): Promise<UbicacionActual> {
    exigirChofer(actor); validarCoordenada(coordenada);
    const chofer = exigirChoferExistente(await this.choferes.obtenerPorUsuario(actor.idUsuario));
    if (!chofer.habilitado || !chofer.carnetConducirValidado) throw new ErrorFlota("CHOFER_NO_HABILITADO", "El chofer no está habilitado para informar ubicación.");
    if (Number.isNaN(actualizadoAt.getTime())) throw new ErrorFlota("FECHA_INVALIDA", "La fecha de ubicación no es válida.");
    if (precisionMetros !== undefined && (!Number.isFinite(precisionMetros) || precisionMetros < 0)) throw new ErrorFlota("PRECISION_INVALIDA", "La precisión debe ser un número positivo.");
    return this.ubicaciones.guardarSiEsMasNueva({ id: this.id(), usuarioId: actor.idUsuario, ...coordenada, actualizadoAt: new Date(actualizadoAt), precisionMetros });
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
  constructor(private readonly ubicaciones = new Map<string, UbicacionActual>()) {}
  async obtenerActual(usuarioId: string): Promise<UbicacionActual | undefined> { const ubicacion = this.ubicaciones.get(usuarioId); return ubicacion ? structuredClone(ubicacion) : undefined; }
  async guardarSiEsMasNueva(ubicacion: UbicacionActual): Promise<UbicacionActual> { const anterior = this.ubicaciones.get(ubicacion.usuarioId); if (anterior && anterior.actualizadoAt.getTime() >= ubicacion.actualizadoAt.getTime()) return structuredClone(anterior); const copia = structuredClone(ubicacion); this.ubicaciones.set(ubicacion.usuarioId, copia); return structuredClone(copia); }
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
