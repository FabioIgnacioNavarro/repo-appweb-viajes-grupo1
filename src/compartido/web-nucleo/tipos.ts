/**
 * Tipos oficiales de la plataforma web, alineados con docs/api.md y docs/contratos.md
 */

export type Rol = "PASAJERO" | "CHOFER" | "SOPORTE" | "ADMINISTRADOR";

export type EstadoViaje =
  | "SOLICITADO"
  | "OFERTADO"
  | "CONFIRMADO"
  | "ASIGNADO"
  | "CHOFER_EN_CAMINO"
  | "EN_CURSO"
  | "FINALIZADO"
  | "CANCELADO";

export type EstadoOferta = "PENDIENTE" | "ACEPTADA" | "VENCIDA" | "CANCELADA";

export type EstadoCobro = "PENDIENTE" | "COBRADO" | "FALLIDO";

export interface Coordenada {
  latitud: number;
  longitud: number;
  direccion?: string;
}

export interface DetalleErrorApi {
  codigo: string;
  mensaje: string;
  detalles?: Record<string, unknown>;
}

export interface SobreErrorApi {
  error: DetalleErrorApi;
}

export interface UsuarioSesion {
  idUsuario: string;
  rol: Rol;
  email?: string;
  nombre?: string;
  token: string;
  expiraEn: number; // timestamp en segundos (exp de JWT)
}

export interface Estimacion {
  id: string;
  precio: string; // pesos enteros como string (ej. "3500")
  distanciaMetros: number;
  duracionSegundos: number;
  multiplicador: string; // ej. "1.25"
  factores: {
    demanda?: number;
    lluvia?: boolean;
    franjaHoraria?: string;
    [clave: string]: unknown;
  };
  vigenciaSegundos: number;
  creadaEn: string;
  expiraEn: string;
}

export interface Viaje {
  id: string;
  idPasajero: string;
  idChofer?: string;
  estado: EstadoViaje;
  precio: string;
  origen: Coordenada;
  destino: Coordenada;
  creadoEn: string;
  actualizadoEn: string;
  idEstimacion?: string;
  multiplicador?: string;
  factoresTarifa?: Record<string, unknown>;
}

export interface OfertaChofer {
  id: string;
  idViaje: string;
  idChofer: string;
  estado: EstadoOferta;
  precio: string;
  expiraEn: string; // ISO timestamp (vigencia 60s)
  origen: Coordenada;
  destino: Coordenada;
}

export interface Cobro {
  id: string;
  idViaje: string;
  monto: string;
  estado: EstadoCobro;
  claveIdempotencia: string;
  fechaCreacion: string;
  metodo?: string;
}

export interface EventoWebSocket {
  tipo:
    | "OFERTA_NUEVA"
    | "OFERTA_VENCIDA"
    | "OFERTA_CANCELADA"
    | "VIAJE_ACTUALIZADO"
    | "UBICACION_CHOFER"
    | "CONEXION_ESTABLECIDA"
    | "ERROR";
  datos: Record<string, unknown>;
  timestamp: string;
}
