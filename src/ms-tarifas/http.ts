import express, { type NextFunction, type Request, type Response } from "express";
import { CrearEstimacion, ErrorTarifas, type Coordenada, type RepositorioEstimaciones } from "./dominio";
import type { ActorJWT, ValidadorJwtJwks } from "../compartido/jwt";

export interface DependenciasTarifas {
  estimar: (pasajeroId: string, origen: Coordenada, destino: Coordenada, token: string) => ReturnType<CrearEstimacion["ejecutar"]>;
  estimaciones: RepositorioEstimaciones;
  validador: Pick<ValidadorJwtJwks, "validar">;
  comprobarBase: () => Promise<void>;
}
declare global { namespace Express { interface Request { actor?: ActorJWT } } }
const objeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);
function coord(valor: unknown): Coordenada | undefined {
  if (!objeto(valor) || typeof valor.latitud !== "number" || typeof valor.longitud !== "number") return undefined;
  return { latitud: valor.latitud, longitud: valor.longitud };
}
function error(res: Response, causa: unknown): void {
  if (causa instanceof ErrorTarifas) {
    const status = causa.codigo === "COORDENADAS_INVALIDAS" ? 400 : causa.codigo === "ZONA_NO_ENCONTRADA" ? 422 : causa.codigo.includes("DESACTUALIZADO") || causa.codigo.includes("NO_DISPONIBLE") || causa.codigo.includes("RESPUESTA") ? 503 : 422;
    res.status(status).json({ error: { codigo: causa.codigo, mensaje: causa.message, detalles: {} } }); return;
  }
  res.status(500).json({ error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error interno.", detalles: {} } });
}
function dto(e: NonNullable<Awaited<ReturnType<RepositorioEstimaciones["obtener"]>>>) {
  const f = e.factoresPrecio;
  return { id_estimacion: e.id, precio_estimado: e.precioEstimado.toString(), moneda: e.moneda, distancia_metros: e.distanciaMetros, duracion_segundos: e.duracionSegundos,
    multiplicador_demanda: e.multiplicadorDemandaEscalado / 10_000, zona: e.zona.nombre,
    factores_precio: { choferes_disponibles: f.choferesDisponibles, solicitudes_activas: f.solicitudesActivas, precipitacion_mm: f.precipitacionMm, llueve: f.llueve, fuente_clima: f.fuenteClima, clima_observado_en: f.climaObservadoEn.toISOString(), franja_horaria: f.franjaHoraria.toLowerCase(), factor_lluvia: f.factorLluviaEscalado / 10_000, factor_disponibilidad: f.factorDisponibilidadEscalado / 10_000, factor_demanda: f.factorDemandaEscalado / 10_000, factor_horario: f.factorHorarioEscalado / 10_000 },
    version_regla: e.versionRegla, creada_en: e.creadaEn.toISOString(), vigente_hasta: e.vigenteHasta.toISOString(), origen: e.origen, destino: e.destino, polilinea: e.polilinea ?? null };
}
export function crearRouterTarifas(deps: DependenciasTarifas): express.Router {
  const router = express.Router();
  router.get("/health", (_req, res) => res.json({ estado: "activo", servicio: "ms-tarifas" }));
  router.get("/ready", async (_req, res) => { try { await deps.comprobarBase(); res.json({ estado: "listo", servicio: "ms-tarifas" }); } catch { res.status(503).json({ estado: "no_listo", servicio: "ms-tarifas" }); } });
  router.use(express.json({ limit: "10kb" }));
  router.use(async (req: Request, res: Response, next: NextFunction) => {
    const token = req.header("Authorization")?.match(/^Bearer ([^ ]+)$/)?.[1];
    if (!token) { res.status(401).json({ error: { codigo: "TOKEN_REQUERIDO", mensaje: "Se requiere Authorization Bearer.", detalles: {} } }); return; }
    try { req.actor = await deps.validador.validar(token); next(); } catch { res.status(401).json({ error: { codigo: "TOKEN_INVALIDO", mensaje: "El token no es válido.", detalles: {} } }); }
  });
  router.post("/viajes/estimacion", async (req, res) => {
    if (!objeto(req.body) || Object.keys(req.body).some((key) => !["origen", "destino"].includes(key))) { res.status(400).json({ error: { codigo: "ENTRADA_INVALIDA", mensaje: "Se requieren origen y destino, sin campos de precio." } }); return; }
    const origen = coord(req.body.origen); const destino = coord(req.body.destino);
    if (!origen || !destino || !req.actor) { res.status(400).json({ error: { codigo: "ENTRADA_INVALIDA", mensaje: "Origen y destino deben incluir latitud y longitud numéricas." } }); return; }
    try { res.status(201).json(dto(await deps.estimar(req.actor.idUsuario, origen, destino, req.header("Authorization")!.slice(7)))); } catch (causa) { error(res, causa); }
  });
  router.get("/estimaciones/:idEstimacion", async (req, res) => {
    const e = await deps.estimaciones.obtener(req.params.idEstimacion);
    if (!e) { res.status(404).json({ error: { codigo: "ESTIMACION_NO_ENCONTRADA", mensaje: "No existe la estimación.", detalles: {} } }); return; }
    if (req.actor?.idUsuario !== e.pasajeroId && !["SOPORTE", "ADMINISTRADOR"].includes(req.actor?.rol ?? "")) { res.status(403).json({ error: { codigo: "ESTIMACION_NO_AUTORIZADA", mensaje: "No podés consultar esta estimación.", detalles: {} } }); return; }
    res.json(dto(e));
  });
  return router;
}
