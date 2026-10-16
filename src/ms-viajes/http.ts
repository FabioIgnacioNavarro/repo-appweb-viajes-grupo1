import express, { type NextFunction, type Request, type Response } from "express";
import {
  AceptarOferta, AvanzarViaje, CancelarViaje, ConfirmarViaje, ConsultarViaje,
  ConsultarChoferesOcupados, ConsultarDemandaPorZona,
  ErrorDominio, FinalizarViaje, RechazarOferta,
  type ActorAutenticado, type EstimacionVigente, type RepositorioOfertas, type RepositorioViajes
} from "./dominio";
import { ErrorDependenciaHttp } from "../compartido/cliente-servicios";

export interface ValidadorToken {
  validar(token: string): Promise<ActorAutenticado>;
}

export interface DependenciasViajes {
  viajes: RepositorioViajes;
  ofertas: RepositorioOfertas;
  confirmar: ConfirmarViaje;
  aceptar: AceptarOferta;
  rechazar: RechazarOferta;
  cancelar: CancelarViaje;
  avanzar: AvanzarViaje;
  finalizar: FinalizarViaje;
  consultar: ConsultarViaje;
  validadorToken: ValidadorToken;
  obtenerEstimacion: (actor: ActorAutenticado, idEstimacion: string, token: string) => Promise<EstimacionVigente | undefined>;
  confirmarConOfertas?: (actor: ActorAutenticado, estimacion: EstimacionVigente, clave: string, token: string) => Promise<ReturnType<ConfirmarViaje["ejecutar"]>>;
  consultarDemanda?: ConsultarDemandaPorZona;
  consultarOcupacion?: ConsultarChoferesOcupados;
}

declare global {
  namespace Express { interface Request { actorAutenticado?: ActorAutenticado; tokenExterno?: string; } }
}

const objeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);
const roles = new Set(["PASAJERO", "CHOFER", "SOPORTE", "ADMINISTRADOR"]);

function actorDe(pedido: Request): ActorAutenticado {
  if (!pedido.actorAutenticado) throw new ErrorDominio("TOKEN_INVALIDO", "No hay actor autenticado.");
  return pedido.actorAutenticado;
}

function errorHttp(error: unknown, respuesta: Response): void {
  if (error instanceof ErrorDependenciaHttp) {
    respuesta.status(503).json({ error: { codigo: "DEPENDENCIA_NO_DISPONIBLE", mensaje: "No se pudo completar la operación por una dependencia temporalmente no disponible.", detalles: {} } });
    return;
  }
  const mapa: Record<string, number> = {
    TOKEN_REQUERIDO: 401, TOKEN_INVALIDO: 401, ROL_NO_AUTORIZADO: 403, VIAJE_NO_AUTORIZADO: 403,
    OFERTA_NO_AUTORIZADA: 403, VIAJE_NO_ENCONTRADO: 404, OFERTA_NO_ENCONTRADA: 404,
    ENTRADA_INVALIDA: 400, CLAVE_IDEMPOTENCIA_REQUERIDA: 400, IMPORTE_INVALIDO: 422,
    ESTIMACION_NO_ENCONTRADA: 404, ESTIMACION_VENCIDA: 409, OFERTA_VENCIDA: 409, OFERTA_NO_DISPONIBLE: 409,
    VIAJE_NO_DISPONIBLE: 409, VIAJE_NO_OFERTABLE: 409, VIAJE_TERMINAL: 409,
    ASIGNACION_EN_CONFLICTO: 409, TRANSICION_INVALIDA: 422
  };
  if (error instanceof ErrorDominio) {
    respuesta.status(mapa[error.codigo] ?? 422).json({ error: { codigo: error.codigo, mensaje: error.message, detalles: {} } });
    return;
  }
  respuesta.status(500).json({ error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error interno.", detalles: {} } });
}

function fecha(valor: Date | undefined): string | undefined { return valor?.toISOString(); }

function viajeDto(viaje: ReturnType<RepositorioViajes["obtener"]>): Record<string, unknown> {
  if (!viaje) return {};
  return {
    id_viaje: viaje.id, pasajero_id: viaje.pasajeroId, chofer_id: viaje.choferId ?? null,
    origen: viaje.origen, destino: viaje.destino, id_estimacion: viaje.estimacionId,
    precio_estimado: viaje.precioEstimado, precio_final: viaje.precioFinal ?? null, moneda: viaje.moneda,
    multiplicador_demanda: viaje.multiplicadorDemanda, factores_precio: viaje.factoresPrecio,
    estado: viaje.estado.toLowerCase(), creado_en: viaje.creadoEn.toISOString(),
    iniciado_en: fecha(viaje.iniciadoEm), finalizado_en: fecha(viaje.finalizadoEm),
    cancelado_en: fecha(viaje.canceladoEm), motivo_cancelacion: viaje.motivoCancelacion ?? null
  };
}

function ofertaDto(oferta: { id: string; viajeId: string; choferId: string; estado: string; enviadaEm: Date; expiraEm: Date; respondidaEm?: Date }): Record<string, unknown> {
  return { id_oferta: oferta.id, id_viaje: oferta.viajeId, id_chofer: oferta.choferId, estado: oferta.estado.toLowerCase(), enviada_en: oferta.enviadaEm.toISOString(), expira_en: oferta.expiraEm.toISOString(), respondida_en: fecha(oferta.respondidaEm) };
}

function validarId(valor: unknown): valor is string { return typeof valor === "string" && valor.length > 0 && valor.length <= 200; }

export function crearRouterViajes(deps: DependenciasViajes): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: "20kb" }));
  router.use(async (pedido: Request, respuesta: Response, siguiente: NextFunction) => {
    const encabezado = pedido.header("Authorization");
    if (!encabezado?.startsWith("Bearer ") || encabezado.length <= 7) { errorHttp(new ErrorDominio("TOKEN_REQUERIDO", "Se requiere Authorization Bearer."), respuesta); return; }
    try {
      pedido.tokenExterno = encabezado.slice(7);
      pedido.actorAutenticado = await deps.validadorToken.validar(pedido.tokenExterno);
      if (!roles.has(pedido.actorAutenticado.rol)) throw new Error("rol invalido");
      siguiente();
    } catch { errorHttp(new ErrorDominio("TOKEN_INVALIDO", "El token no es válido."), respuesta); }
  });

  router.get("/interno/demanda-por-zona", (pedido, respuesta) => {
    const actor = actorDe(pedido);
    const zonaId = pedido.query.zona_id;
    if (actor.rol !== "PASAJERO" || typeof zonaId !== "string" || zonaId.length < 1 || zonaId.length > 100 || !deps.consultarDemanda) {
      respuesta.status(actor.rol !== "PASAJERO" ? 403 : 400).json({ error: { codigo: actor.rol !== "PASAJERO" ? "ROL_NO_AUTORIZADO" : "ENTRADA_INVALIDA", mensaje: "No se pudo consultar la demanda para esa zona.", detalles: {} } }); return;
    }
    respuesta.status(200).json({ zona_id: zonaId, solicitudes_activas: deps.consultarDemanda.ejecutar(zonaId) });
  });

  router.get("/interno/choferes/ocupados", (pedido, respuesta) => {
    const actor = actorDe(pedido);
    const parametro = pedido.query.ids_choferes;
    const ids = typeof parametro === "string" ? [...new Set(parametro.split(",").filter((id) => id.length > 0 && id.length <= 200))] : [];
    if (actor.rol !== "PASAJERO" || !deps.consultarOcupacion || ids.length > 100 || ids.length === 0) {
      respuesta.status(actor.rol !== "PASAJERO" ? 403 : 400).json({ error: { codigo: actor.rol !== "PASAJERO" ? "ROL_NO_AUTORIZADO" : "ENTRADA_INVALIDA", mensaje: "No se pudo consultar la ocupación.", detalles: {} } }); return;
    }
    respuesta.status(200).json({ ids_choferes_ocupados: deps.consultarOcupacion.ejecutar(ids) });
  });

  router.post("/viajes", async (pedido, respuesta) => {
    try {
      const cuerpo = pedido.body as unknown;
      const clave = pedido.header("Clave-Idempotencia");
      if (!objeto(cuerpo) || Object.keys(cuerpo).some((campo) => campo !== "id_estimacion") || !validarId(cuerpo.id_estimacion) || !clave || clave.length > 200) throw new ErrorDominio("ENTRADA_INVALIDA", "id_estimacion y Clave-Idempotencia son obligatorios.");
      const estimacion = await deps.obtenerEstimacion(actorDe(pedido), cuerpo.id_estimacion, pedido.tokenExterno!);
      if (!estimacion) throw new ErrorDominio("ESTIMACION_NO_ENCONTRADA", "La estimación no existe o no está autorizada.");
      const viaje = deps.confirmarConOfertas
        ? await deps.confirmarConOfertas(actorDe(pedido), estimacion, clave, pedido.tokenExterno!)
        : deps.confirmar.ejecutar(actorDe(pedido), estimacion, clave);
      respuesta.status(201).json(viajeDto(viaje));
    } catch (error) { errorHttp(error, respuesta); }
  });

  router.get("/viajes", (pedido, respuesta) => {
    try {
      const actor = actorDe(pedido);
      const propios = deps.viajes.listar().filter((viaje) => viaje.pasajeroId === actor.idUsuario || viaje.choferId === actor.idUsuario || actor.rol === "SOPORTE" || actor.rol === "ADMINISTRADOR");
      respuesta.status(200).json({ viajes: propios.map(viajeDto) });
    } catch (error) { errorHttp(error, respuesta); }
  });

  router.get("/viajes/:idViaje", (pedido, respuesta) => {
    try { respuesta.status(200).json(viajeDto(deps.consultar.ejecutar(actorDe(pedido), pedido.params.idViaje))); } catch (error) { errorHttp(error, respuesta); }
  });

  router.get("/viajes/:idViaje/seguimiento", (pedido, respuesta) => {
    try { respuesta.status(200).json(viajeDto(deps.consultar.ejecutar(actorDe(pedido), pedido.params.idViaje))); } catch (error) { errorHttp(error, respuesta); }
  });

  router.post("/viajes/:idViaje/cancelacion", (pedido, respuesta) => {
    try {
      const cuerpo = pedido.body as unknown;
      const motivo = objeto(cuerpo) && typeof cuerpo.motivo === "string" ? cuerpo.motivo : "sin motivo informado";
      respuesta.status(200).json(viajeDto(deps.cancelar.ejecutar(actorDe(pedido), pedido.params.idViaje, motivo)));
    } catch (error) { errorHttp(error, respuesta); }
  });

  router.post("/viajes/:idViaje/llegada", (pedido, respuesta) => {
    try { respuesta.status(200).json(viajeDto(deps.avanzar.ejecutar(actorDe(pedido), pedido.params.idViaje, "CHOFER_EN_CAMINO"))); } catch (error) { errorHttp(error, respuesta); }
  });

  router.post("/viajes/:idViaje/inicio", (pedido, respuesta) => {
    try { respuesta.status(200).json(viajeDto(deps.avanzar.ejecutar(actorDe(pedido), pedido.params.idViaje, "EN_CURSO"))); } catch (error) { errorHttp(error, respuesta); }
  });

  router.post("/viajes/:idViaje/finalizacion", (pedido, respuesta) => {
    try { const resultado = deps.finalizar.ejecutar(actorDe(pedido), pedido.params.idViaje); respuesta.status(200).json({ viaje: viajeDto(resultado.viaje), cobro: { id_cobro: resultado.cobro.id, importe: resultado.cobro.importe, moneda: resultado.cobro.moneda, estado: resultado.cobro.estado.toLowerCase() } }); } catch (error) { errorHttp(error, respuesta); }
  });

  router.get("/choferes/yo/ofertas", (pedido, respuesta) => {
    try { const actor = actorDe(pedido); if (actor.rol !== "CHOFER") throw new ErrorDominio("ROL_NO_AUTORIZADO", "Solo un chofer puede consultar sus ofertas."); respuesta.status(200).json({ ofertas: deps.ofertas.listarPorChofer(actor.idUsuario).map(ofertaDto) }); } catch (error) { errorHttp(error, respuesta); }
  });

  router.post("/choferes/yo/ofertas/:idOferta/aceptacion", (pedido, respuesta) => {
    try { respuesta.status(200).json(viajeDto(deps.aceptar.ejecutar(actorDe(pedido), pedido.params.idOferta))); } catch (error) { errorHttp(error, respuesta); }
  });

  router.post("/choferes/yo/ofertas/:idOferta/rechazo", (pedido, respuesta) => {
    try { respuesta.status(200).json(ofertaDto(deps.rechazar.ejecutar(actorDe(pedido), pedido.params.idOferta))); } catch (error) { errorHttp(error, respuesta); }
  });

  return router;
}

/** Adaptador explícito para desarrollo y tests; no reemplaza la validación JWKS en producción. */
export class ValidadorTokenFalso implements ValidadorToken {
  constructor(private readonly actores: Record<string, ActorAutenticado>) {}
  async validar(token: string): Promise<ActorAutenticado> {
    const actor = this.actores[token];
    if (!actor) throw new Error("Token falso desconocido.");
    return actor;
  }
}
