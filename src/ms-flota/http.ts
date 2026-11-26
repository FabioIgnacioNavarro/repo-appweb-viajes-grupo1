import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { registrarLogEstructurado } from "../compartido/observabilidad";
import type { ValidadorToken } from "../compartido/jwt";
import { manejarErrorCuerpoHttp } from "../compartido/seguridad-http";
import {
  AsignarVehiculoAChofer,
  BuscarChoferesCercanos,
  CambiarDisponibilidadChofer,
  ConsultarUbicacionChofer,
  ErrorFlota,
  HabilitarChofer,
  ListarChoferesFlota,
  ListarVehiculosFlota,
  RegistrarChofer,
  RegistrarUbicacionActual,
  RegistrarVehiculo,
  type ActorAutenticado,
  type AutorizadorUbicacion,
  type RepositorioChoferes,
  type RepositorioUbicaciones,
  type RepositorioVehiculos,
  type RepositorioViajesActivos,
  type Vehiculo
} from "./dominio";

export interface PublicadorUbicacionViaje { publicar(actor: ActorAutenticado, ubicacion: { latitud: number; longitud: number; actualizadoAt: Date }, jwt: string): Promise<void>; }
export interface DependenciasFlota {
  choferes: RepositorioChoferes;
  ubicaciones: RepositorioUbicaciones;
  viajes: RepositorioViajesActivos;
  vehiculos?: RepositorioVehiculos;
  crearRepositorioViajes?(jwt: string): RepositorioViajesActivos;
  validadorToken: ValidadorToken;
  autorizador: AutorizadorUbicacion;
  publicadorUbicacionViaje?: PublicadorUbicacionViaje;
}

function objeto(valor: unknown): valor is Record<string, unknown> { return typeof valor === "object" && valor !== null && !Array.isArray(valor); }
function errorHttp(error: unknown, respuesta: Response): void {
  const mapa: Record<string, number> = {
    ROL_NO_AUTORIZADO: 403,
    CHOFER_NO_ENCONTRADO: 404,
    VEHICULO_NO_ENCONTRADO: 404,
    UBICACION_NO_AUTORIZADA: 403,
    CHOFER_NO_HABILITADO: 409,
    CHOFER_SIN_VEHICULO_ACTIVO: 409,
    CHOFER_YA_EXISTE: 409,
    VEHICULO_YA_EXISTE: 409,
    VEHICULO_INACTIVO: 409,
    COORDENADAS_INVALIDAS: 400,
    ENTRADA_INVALIDA: 400,
    VEHICULO_INVALIDO: 422,
    RADIO_INVALIDO: 400,
    FECHA_INVALIDA: 400,
    PRECISION_INVALIDA: 400,
    DEPENDENCIA_NO_DISPONIBLE: 503
  };
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

  router.patch("/choferes/yo/disponibilidad", autenticar, async (pedido, respuesta) => {
    try { const cuerpo = pedido.body as unknown; if (!objeto(cuerpo) || typeof cuerpo.disponibilidad !== "boolean") { respuesta.status(400).json({ error: { codigo: "ENTRADA_INVALIDA", mensaje: "disponibilidad debe ser boolean.", detalles: {} } }); return; } const actor = actorDe(pedido); respuesta.status(200).json(serializarChofer(await new CambiarDisponibilidadChofer(dependencias.choferes, dependencias.vehiculos).ejecutar(actor, cuerpo.disponibilidad))); } catch (error) { errorHttp(error, respuesta); }
  });

  router.post("/choferes/yo/ubicacion", autenticar, async (pedido, respuesta) => {
    try {
      const cuerpo = pedido.body as unknown;
      if (!objeto(cuerpo) || typeof cuerpo.latitud !== "number" || typeof cuerpo.longitud !== "number") { respuesta.status(400).json({ error: { codigo: "COORDENADAS_INVALIDAS", mensaje: "latitud y longitud son obligatorias.", detalles: {} } }); return; }
      const actualizado = typeof cuerpo.actualizado_at === "string" ? new Date(cuerpo.actualizado_at) : new Date();
      const precision = typeof cuerpo.precision_metros === "number" ? cuerpo.precision_metros : undefined;
      const actor = actorDe(pedido);
      const ubicacion = await new RegistrarUbicacionActual(dependencias.choferes, dependencias.ubicaciones, randomUUID).ejecutar(actor, { latitud: cuerpo.latitud, longitud: cuerpo.longitud }, actualizado, precision);
      if (dependencias.publicadorUbicacionViaje && ubicacion.actualizadoAt.getTime() === actualizado.getTime()) {
        try { await dependencias.publicadorUbicacionViaje.publicar(actor, ubicacion, pedido.jwtExterno!); }
        catch { registrarLogEstructurado({ evento: "dependencia_http_fallida", servicio: "ms-viajes", operacion: "publicar_ubicacion_tiempo_real", resultado: "timeout_o_red" }, "ERROR"); }
      }
      respuesta.status(200).json(serializarUbicacion(ubicacion));
    } catch (error) { errorHttp(error, respuesta); }
  });

  router.get("/choferes/cercanos", autenticar, async (pedido, respuesta) => {
    try { const latitud = Number(pedido.query.latitud); const longitud = Number(pedido.query.longitud); const radio = Number(pedido.query.radio_metros ?? 5000); const viajes = dependencias.crearRepositorioViajes?.(pedido.jwtExterno!) ?? dependencias.viajes; const candidatos = await new BuscarChoferesCercanos(dependencias.choferes, viajes).ejecutar(actorDe(pedido), { latitud, longitud }, radio); respuesta.status(200).json({ candidatos: candidatos.map((candidato) => ({ id_chofer: candidato.usuarioId, distancia_metros: Math.round(candidato.distanciaMetros), ubicacion_actualizada_at: candidato.actualizadoAt.toISOString() })) }); } catch (error) { errorHttp(error, respuesta); }
  });

  router.get("/choferes", autenticar, async (pedido, respuesta) => {
    try {
      const lista = await new ListarChoferesFlota(dependencias.choferes, dependencias.vehiculos).ejecutar(actorDe(pedido));
      respuesta.status(200).json({
        choferes: lista.map(({ chofer, vehiculoActivo }) => ({
          ...serializarChofer(chofer),
          vehiculo_activo: vehiculoActivo ? serializarVehiculo(vehiculoActivo) : null
        }))
      });
    } catch (error) { errorHttp(error, respuesta); }
  });

  router.post("/choferes", autenticar, async (pedido, respuesta) => {
    try {
      const cuerpo = objeto(pedido.body) ? pedido.body : {};
      const chofer = await new RegistrarChofer(dependencias.choferes, randomUUID).ejecutar(actorDe(pedido), {
        usuarioId: typeof cuerpo.usuario_id === "string" ? cuerpo.usuario_id : undefined,
        carnetConducirValidado: typeof cuerpo.carnet_conducir_validado === "boolean" ? cuerpo.carnet_conducir_validado : undefined,
        habilitado: typeof cuerpo.habilitado === "boolean" ? cuerpo.habilitado : undefined
      });
      respuesta.status(201).json(serializarChofer(chofer));
    } catch (error) { errorHttp(error, respuesta); }
  });

  router.patch<{ idChofer: string }>("/choferes/:idChofer/habilitacion", autenticar, async (pedido, respuesta) => {
    try {
      const cuerpo = pedido.body as unknown;
      if (!objeto(cuerpo) || typeof cuerpo.habilitado !== "boolean") {
        respuesta.status(400).json({ error: { codigo: "ENTRADA_INVALIDA", mensaje: "habilitado debe ser boolean.", detalles: {} } });
        return;
      }
      const chofer = await new HabilitarChofer(dependencias.choferes).ejecutar(actorDe(pedido), pedido.params.idChofer, {
        habilitado: cuerpo.habilitado,
        carnetConducirValidado: typeof cuerpo.carnet_conducir_validado === "boolean" ? cuerpo.carnet_conducir_validado : undefined
      });
      respuesta.status(200).json(serializarChofer(chofer));
    } catch (error) { errorHttp(error, respuesta); }
  });

  const asignarVehiculoHandler = async (pedido: Request<{ idChofer: string }>, respuesta: Response): Promise<void> => {
    try {
      if (!dependencias.vehiculos) throw new ErrorFlota("DEPENDENCIA_NO_DISPONIBLE", "El repositorio de vehículos no está configurado.");
      const cuerpo = pedido.body as unknown;
      const vehiculoId = objeto(cuerpo) && typeof cuerpo.id_vehiculo === "string" ? cuerpo.id_vehiculo.trim() : "";
      if (!vehiculoId) {
        respuesta.status(400).json({ error: { codigo: "ENTRADA_INVALIDA", mensaje: "id_vehiculo es obligatorio.", detalles: {} } });
        return;
      }
      const resultado = await new AsignarVehiculoAChofer(dependencias.choferes, dependencias.vehiculos, randomUUID).ejecutar(actorDe(pedido), pedido.params.idChofer, vehiculoId);
      respuesta.status(200).json({
        chofer: serializarChofer(resultado.chofer),
        vehiculo: serializarVehiculo(resultado.vehiculo),
        asignacion: {
          id: resultado.asignacion.id,
          estado_asignacion: resultado.asignacion.estadoAsignacion,
          asignado_at: resultado.asignacion.asignadoAt.toISOString()
        }
      });
    } catch (error) { errorHttp(error, respuesta); }
  };

  router.post<{ idChofer: string }>("/choferes/:idChofer/vehiculo", autenticar, asignarVehiculoHandler);
  router.put<{ idChofer: string }>("/choferes/:idChofer/vehiculo", autenticar, asignarVehiculoHandler);

  router.get("/vehiculos", autenticar, async (pedido, respuesta) => {
    try {
      if (!dependencias.vehiculos) throw new ErrorFlota("DEPENDENCIA_NO_DISPONIBLE", "El repositorio de vehículos no está configurado.");
      const lista = await new ListarVehiculosFlota(dependencias.vehiculos).ejecutar(actorDe(pedido));
      respuesta.status(200).json({ vehiculos: lista.map(serializarVehiculo) });
    } catch (error) { errorHttp(error, respuesta); }
  });

  router.post("/vehiculos", autenticar, async (pedido, respuesta) => {
    try {
      if (!dependencias.vehiculos) throw new ErrorFlota("DEPENDENCIA_NO_DISPONIBLE", "El repositorio de vehículos no está configurado.");
      const cuerpo = pedido.body as unknown;
      if (
        !objeto(cuerpo)
        || typeof cuerpo.patente !== "string"
        || typeof cuerpo.tipo_vehiculo !== "string"
        || typeof cuerpo.marca !== "string"
        || typeof cuerpo.modelo !== "string"
        || typeof cuerpo.anio_fabricacion !== "number"
        || typeof cuerpo.color !== "string"
        || typeof cuerpo.capacidad_pasajeros !== "number"
      ) {
        respuesta.status(400).json({ error: { codigo: "ENTRADA_INVALIDA", mensaje: "Todos los datos del vehículo son obligatorios.", detalles: {} } });
        return;
      }
      const vehiculo = await new RegistrarVehiculo(dependencias.vehiculos, randomUUID).ejecutar(actorDe(pedido), {
        patente: cuerpo.patente,
        tipoVehiculo: cuerpo.tipo_vehiculo,
        marca: cuerpo.marca,
        modelo: cuerpo.modelo,
        anioFabricacion: cuerpo.anio_fabricacion,
        color: cuerpo.color,
        capacidadPasajeros: cuerpo.capacidad_pasajeros
      });
      respuesta.status(201).json(serializarVehiculo(vehiculo));
    } catch (error) { errorHttp(error, respuesta); }
  });

  router.get<{ idChofer: string }>("/choferes/:idChofer", autenticar, async (pedido, respuesta) => {
    try { const resultado = await new ConsultarUbicacionChofer(dependencias.choferes, dependencias.ubicaciones, dependencias.autorizador).ejecutar(actorDe(pedido), pedido.params.idChofer); respuesta.status(200).json({ chofer: serializarChofer(resultado.chofer), ubicacion: resultado.ubicacion ? serializarUbicacion(resultado.ubicacion) : null }); } catch (error) { errorHttp(error, respuesta); }
  });
  // Mantener el 401 previo para rutas desconocidas, pero permitir que Express
  // asigne req.route antes de rechazar credenciales en rutas conocidas.
  router.use(autenticar);
  router.use(manejarErrorCuerpoHttp);
  return router;
}

function resaltarActor(pedido: Request, actor: ActorAutenticado): void { pedido.actorAutenticado = actor; }
function actorDe(pedido: Request): ActorAutenticado { const actor = pedido.actorAutenticado; if (!actor) throw new ErrorFlota("TOKEN_INVALIDO", "No hay actor autenticado."); return actor; }
function serializarChofer(chofer: { id: string; usuarioId: string; habilitado: boolean; disponibilidad: boolean; carnetConducirValidado: boolean; fechaCreacion: Date; fechaActualizacion: Date }) { return { id: chofer.id, usuario_id: chofer.usuarioId, habilitado: chofer.habilitado, disponibilidad: chofer.disponibilidad, carnet_conducir_validado: chofer.carnetConducirValidado, fecha_creacion: chofer.fechaCreacion.toISOString(), fecha_actualizacion: chofer.fechaActualizacion.toISOString() }; }
function serializarUbicacion(ubicacion: { id: string; usuarioId: string; latitud: number; longitud: number; actualizadoAt: Date; precisionMetros?: number }) { return { id: ubicacion.id, usuario_id: ubicacion.usuarioId, latitud: ubicacion.latitud, longitud: ubicacion.longitud, actualizado_at: ubicacion.actualizadoAt.toISOString(), precision_metros: ubicacion.precisionMetros ?? null }; }
function serializarVehiculo(vehiculo: Vehiculo) {
  return {
    id: vehiculo.id,
    patente: vehiculo.patente,
    tipo_vehiculo: vehiculo.tipoVehiculo,
    marca: vehiculo.marca,
    modelo: vehiculo.modelo,
    anio_fabricacion: vehiculo.anioFabricacion,
    color: vehiculo.color,
    capacidad_pasajeros: vehiculo.capacidadPasajeros,
    estado: vehiculo.estado,
    created_at: vehiculo.createdAt.toISOString(),
    updated_at: vehiculo.updatedAt.toISOString()
  };
}
