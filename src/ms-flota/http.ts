import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { ValidadorToken } from "../compartido/jwt";
import { BuscarChoferesCercanos, CambiarDisponibilidadChofer, ConsultarUbicacionChofer, ErrorFlota, RegistrarUbicacionActual, type ActorAutenticado, type AutorizadorUbicacion, type RepositorioChoferes, type RepositorioUbicaciones, type RepositorioViajesActivos } from "./dominio";

export interface DependenciasFlota { choferes: RepositorioChoferes; ubicaciones: RepositorioUbicaciones; viajes: RepositorioViajesActivos; crearRepositorioViajes?(jwt: string): RepositorioViajesActivos; validadorToken: ValidadorToken; autorizador: AutorizadorUbicacion; }

function objeto(valor: unknown): valor is Record<string, unknown> { return typeof valor === "object" && valor !== null; }
function errorHttp(error: unknown, respuesta: Response): void {
  const mapa: Record<string, number> = { ROL_NO_AUTORIZADO: 403, CHOFER_NO_ENCONTRADO: 404, UBICACION_NO_AUTORIZADA: 403, CHOFER_NO_HABILITADO: 409, COORDENADAS_INVALIDAS: 400, RADIO_INVALIDO: 400, FECHA_INVALIDA: 400, PRECISION_INVALIDA: 400, DEPENDENCIA_NO_DISPONIBLE: 503 };
  if (error instanceof ErrorFlota) { respuesta.status(mapa[error.codigo] ?? 422).json({ error: { codigo: error.codigo, mensaje: error.codigo === "DEPENDENCIA_NO_DISPONIBLE" ? "No se pudo verificar la disponibilidad de los choferes." : error.message, detalles: {} } }); return; }
  respuesta.status(500).json({ error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error interno.", detalles: {} } });
}

export function crearRouterFlota(dependencias: DependenciasFlota): express.Router {
  const router = express.Router();
  const autenticar = async (pedido: Request, respuesta: Response, siguiente: NextFunction): Promise<void> => {
    const encabezado = pedido.header("Authorization");
    if (!encabezado?.startsWith("Bearer ")) { respuesta.status(401).json({ error: { codigo: "TOKEN_REQUERIDO", mensaje: "Se requiere Authorization Bearer.", detalles: {} } }); return; }
    try { resaltarActor(pedido, await dependencias.validadorToken.validar(encabezado.slice(7))); pedido.jwtExterno = encabezado.slice(7); siguiente(); } catch { respuesta.status(401).json({ error: { codigo: "TOKEN_INVALIDO", mensaje: "El token no es válido.", detalles: {} } }); }
  };
  router.use(express.json({ limit: "10kb" }));
  router.use(autenticar);

  router.patch("/choferes/yo/disponibilidad", async (pedido, respuesta) => {
    try { const cuerpo = pedido.body as unknown; if (!objeto(cuerpo) || typeof cuerpo.disponibilidad !== "boolean") { respuesta.status(400).json({ error: { codigo: "ENTRADA_INVALIDA", mensaje: "disponibilidad debe ser boolean.", detalles: {} } }); return; } const actor = actorDe(pedido); respuesta.status(200).json(serializarChofer(await new CambiarDisponibilidadChofer(dependencias.choferes).ejecutar(actor, cuerpo.disponibilidad))); } catch (error) { errorHttp(error, respuesta); }
  });

  router.post("/choferes/yo/ubicacion", async (pedido, respuesta) => {
    try { const cuerpo = pedido.body as unknown; if (!objeto(cuerpo) || typeof cuerpo.latitud !== "number" || typeof cuerpo.longitud !== "number") { respuesta.status(400).json({ error: { codigo: "COORDENADAS_INVALIDAS", mensaje: "latitud y longitud son obligatorias.", detalles: {} } }); return; } const actualizado = typeof cuerpo.actualizado_at === "string" ? new Date(cuerpo.actualizado_at) : new Date(); const precision = typeof cuerpo.precision_metros === "number" ? cuerpo.precision_metros : undefined; const actor = actorDe(pedido); respuesta.status(200).json(serializarUbicacion(await new RegistrarUbicacionActual(dependencias.choferes, dependencias.ubicaciones, randomUUID).ejecutar(actor, { latitud: cuerpo.latitud, longitud: cuerpo.longitud }, actualizado, precision))); } catch (error) { errorHttp(error, respuesta); }
  });

  router.get("/choferes/cercanos", async (pedido, respuesta) => {
    try { const latitud = Number(pedido.query.latitud); const longitud = Number(pedido.query.longitud); const radio = Number(pedido.query.radio_metros ?? 5000); const viajes = dependencias.crearRepositorioViajes?.(pedido.jwtExterno!) ?? dependencias.viajes; const candidatos = await new BuscarChoferesCercanos(dependencias.choferes, viajes).ejecutar(actorDe(pedido), { latitud, longitud }, radio); respuesta.status(200).json({ candidatos: candidatos.map((candidato) => ({ id_chofer: candidato.usuarioId, distancia_metros: Math.round(candidato.distanciaMetros), ubicacion_actualizada_at: candidato.actualizadoAt.toISOString() })) }); } catch (error) { errorHttp(error, respuesta); }
  });

  router.get("/choferes/:idChofer", async (pedido, respuesta) => {
    try { const resultado = await new ConsultarUbicacionChofer(dependencias.choferes, dependencias.ubicaciones, dependencias.autorizador).ejecutar(actorDe(pedido), pedido.params.idChofer); respuesta.status(200).json({ chofer: serializarChofer(resultado.chofer), ubicacion: resultado.ubicacion ? serializarUbicacion(resultado.ubicacion) : null }); } catch (error) { errorHttp(error, respuesta); }
  });
  return router;
}

function resaltarActor(pedido: Request, actor: ActorAutenticado): void { pedido.actorAutenticado = actor; }
function actorDe(pedido: Request): ActorAutenticado { const actor = pedido.actorAutenticado; if (!actor) throw new ErrorFlota("TOKEN_INVALIDO", "No hay actor autenticado."); return actor; }
function serializarChofer(chofer: { id: string; usuarioId: string; habilitado: boolean; disponibilidad: boolean; carnetConducirValidado: boolean; fechaCreacion: Date; fechaActualizacion: Date }) { return { id: chofer.id, usuario_id: chofer.usuarioId, habilitado: chofer.habilitado, disponibilidad: chofer.disponibilidad, carnet_conducir_validado: chofer.carnetConducirValidado, fecha_creacion: chofer.fechaCreacion.toISOString(), fecha_actualizacion: chofer.fechaActualizacion.toISOString() }; }
function serializarUbicacion(ubicacion: { id: string; usuarioId: string; latitud: number; longitud: number; actualizadoAt: Date; precisionMetros?: number }) { return { id: ubicacion.id, usuario_id: ubicacion.usuarioId, latitud: ubicacion.latitud, longitud: ubicacion.longitud, actualizado_at: ubicacion.actualizadoAt.toISOString(), precision_metros: ubicacion.precisionMetros ?? null }; }
