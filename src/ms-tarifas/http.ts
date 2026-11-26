import express, { type NextFunction, type Request, type Response } from "express";
import {
  CrearEstimacion,
  ErrorTarifas,
  GestionarReglaDemanda,
  validarCoordenada,
  type Coordenada,
  type FactorPorUmbral,
  type FranjaHoraria,
  type NuevaReglaDemandaInput,
  type PuntoUbicacion,
  type ReglaTarifa,
  type RepositorioEstimaciones,
  type SimulacionTarifaInput,
  type SugerenciaDireccion,
} from "./dominio";
import type { ActorJWT, ValidadorJwtJwks } from "../compartido/jwt";
import { manejarErrorCuerpoHttp } from "../compartido/seguridad-http";

export interface DependenciasTarifas {
  estimar: (
    pasajeroId: string,
    origen: PuntoUbicacion,
    destino: PuntoUbicacion,
    token: string,
    simulacion?: SimulacionTarifaInput
  ) => ReturnType<CrearEstimacion["ejecutar"]>;
  estimaciones: RepositorioEstimaciones;
  reglas?: GestionarReglaDemanda;
  geocodificarInversa?: (coordenada: Coordenada) => Promise<string>;
  autocompletar?: (consulta: string, centro?: Coordenada) => Promise<SugerenciaDireccion[]>;
  validador: Pick<ValidadorJwtJwks, "validar">;
  comprobarBase: () => Promise<void>;
  modoDesarrollador?: boolean;
}
declare global { namespace Express { interface Request { actor?: ActorJWT } } }
const objeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);
function puntoUbicacion(valor: unknown): PuntoUbicacion | undefined {
  if (!objeto(valor)) return undefined;
  if (typeof valor.latitud === "number" && typeof valor.longitud === "number") {
    const direccion = typeof valor.direccion === "string" ? valor.direccion.trim() : undefined;
    if (direccion !== undefined && (!direccion || direccion.length > 500)) return undefined;
    return { latitud: valor.latitud, longitud: valor.longitud, ...(direccion ? { direccion } : {}) };
  }
  if (typeof valor.direccion === "string" && valor.direccion.trim().length > 0 && valor.direccion.trim().length <= 500) {
    return { direccion: valor.direccion.trim() };
  }
  return undefined;
}
function error(res: Response, causa: unknown): void {
  if (causa instanceof ErrorTarifas) {
    const esFallaDependencia =
      causa.codigo.startsWith("DEPENDENCIA") ||
      causa.codigo.includes("DESACTUALIZADO") ||
      causa.codigo.includes("RESPUESTA") ||
      causa.codigo === "PROVEEDOR_RUTA_RECHAZO";
    if (esFallaDependencia) {
      res.status(503).json({
        error: {
          codigo: "DEPENDENCIA_NO_DISPONIBLE",
          mensaje: causa.message,
          detalles: causa.codigo === "DEPENDENCIA_NO_DISPONIBLE" ? {} : { motivo: causa.codigo }
        }
      });
      return;
    }
    const status = causa.codigo === "COORDENADAS_INVALIDAS" || causa.codigo === "DIRECCION_INVALIDA" || causa.codigo === "ENTRADA_INVALIDA"
      ? 400
      : causa.codigo === "DIRECCION_NO_ENCONTRADA"
        ? 404
        : 422;
    res.status(status).json({ error: { codigo: causa.codigo, mensaje: causa.message, detalles: {} } }); return;
  }
  res.status(500).json({ error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error interno.", detalles: {} } });
}

const CAMPOS_REGLA_PERMITIDOS = new Set([
  "multiplicador_minimo",
  "multiplicador_maximo",
  "lluvia_con_precipitacion",
  "lluvia_sin_precipitacion",
  "disponibilidad",
  "demanda_por_mil",
  "horario"
]);
const FRANJAS_HORARIAS: readonly FranjaHoraria[] = ["MADRUGADA", "MANANA", "SIESTA", "TARDE", "NOCHE"];

function escalarMultiplicador(valor: unknown, campo: string): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    throw new ErrorTarifas("ENTRADA_INVALIDA", `${campo} debe ser un número válido.`);
  }
  const escalado = Math.round(valor * 10_000);
  if (Math.abs(valor * 10_000 - escalado) > 1e-6) {
    throw new ErrorTarifas("ENTRADA_INVALIDA", `${campo} admite como máximo 4 decimales.`);
  }
  return escalado;
}

function parsearCurvaDto(valor: unknown, campo: string): FactorPorUmbral[] {
  if (!Array.isArray(valor)) {
    throw new ErrorTarifas("ENTRADA_INVALIDA", `${campo} debe ser una lista de tramos.`);
  }
  return valor.map((item, idx) => {
    if (!objeto(item) || Object.keys(item).some((k) => k !== "hasta" && k !== "multiplicador")) {
      throw new ErrorTarifas("ENTRADA_INVALIDA", `Tramo ${idx + 1} de ${campo} contiene campos inválidos.`);
    }
    const hastaCrudo = item.hasta;
    let hasta: number;
    if (hastaCrudo === null) {
      hasta = Number.MAX_SAFE_INTEGER;
    } else if (typeof hastaCrudo === "number" && Number.isSafeInteger(hastaCrudo) && hastaCrudo >= 0) {
      hasta = hastaCrudo;
    } else {
      throw new ErrorTarifas("ENTRADA_INVALIDA", `El umbral 'hasta' del tramo ${idx + 1} de ${campo} debe ser un entero >= 0 o null.`);
    }
    return {
      hasta,
      multiplicadorEscalado: escalarMultiplicador(item.multiplicador, `${campo}[${idx}].multiplicador`)
    };
  });
}

function parsearReglaDemandaBody(cuerpo: unknown): Partial<NuevaReglaDemandaInput> {
  if (!objeto(cuerpo)) {
    throw new ErrorTarifas("ENTRADA_INVALIDA", "El cuerpo debe ser un objeto JSON.");
  }
  const claves = Object.keys(cuerpo);
  if (claves.length === 0 || claves.some((c) => !CAMPOS_REGLA_PERMITIDOS.has(c))) {
    throw new ErrorTarifas(
      "ENTRADA_INVALIDA",
      "Solo se pueden editar los multiplicadores y umbrales dinámicos; autor, fecha, versión y precio son definidos por el servidor."
    );
  }
  if (cuerpo.multiplicador_minimo === undefined || cuerpo.multiplicador_maximo === undefined || cuerpo.demanda_por_mil === undefined) {
    throw new ErrorTarifas("ENTRADA_INVALIDA", "multiplicador_minimo, multiplicador_maximo y demanda_por_mil son obligatorios.");
  }
  const resultado: Partial<NuevaReglaDemandaInput> = {
    multiplicadorMinimoEscalado: escalarMultiplicador(cuerpo.multiplicador_minimo, "multiplicador_minimo"),
    multiplicadorMaximoEscalado: escalarMultiplicador(cuerpo.multiplicador_maximo, "multiplicador_maximo"),
    demandaPorMil: parsearCurvaDto(cuerpo.demanda_por_mil, "demanda_por_mil")
  };
  if (cuerpo.lluvia_con_precipitacion !== undefined) {
    resultado.lluviaConPrecipitacionEscalado = escalarMultiplicador(cuerpo.lluvia_con_precipitacion, "lluvia_con_precipitacion");
  }
  if (cuerpo.lluvia_sin_precipitacion !== undefined) {
    resultado.lluviaSinPrecipitacionEscalado = escalarMultiplicador(cuerpo.lluvia_sin_precipitacion, "lluvia_sin_precipitacion");
  }
  if (cuerpo.disponibilidad !== undefined) {
    resultado.disponibilidad = parsearCurvaDto(cuerpo.disponibilidad, "disponibilidad");
  }
  if (cuerpo.horario !== undefined) {
    if (!objeto(cuerpo.horario)) {
      throw new ErrorTarifas("ENTRADA_INVALIDA", "horario debe ser un objeto con las franjas horarias.");
    }
    const horarioClaves = Object.keys(cuerpo.horario);
    if (horarioClaves.some((k) => !FRANJAS_HORARIAS.includes(k as FranjaHoraria))) {
      throw new ErrorTarifas("ENTRADA_INVALIDA", "horario contiene una franja horaria desconocida.");
    }
    const horario = {} as Record<FranjaHoraria, number>;
    for (const franja of FRANJAS_HORARIAS) {
      if (cuerpo.horario[franja] === undefined) {
        throw new ErrorTarifas("ENTRADA_INVALIDA", `Falta la franja horaria ${franja}.`);
      }
      horario[franja] = escalarMultiplicador(cuerpo.horario[franja], `horario.${franja}`);
    }
    resultado.horario = horario;
  }
  return resultado;
}

function reglaDto(r: ReglaTarifa) {
  return {
    version: r.version,
    autor: r.autorId ?? "sistema",
    creada_en: (r.creadaEn ?? new Date(0)).toISOString(),
    activa: r.activa ?? true,
    tarifa_base_pesos: r.tarifaBasePesos.toString(),
    precio_por_kilometro_pesos: r.precioPorKilometroPesos.toString(),
    precio_por_minuto_pesos: r.precioPorMinutoPesos.toString(),
    multiplicador_minimo: r.multiplicadorMinimoEscalado / 10_000,
    multiplicador_maximo: r.multiplicadorMaximoEscalado / 10_000,
    lluvia_con_precipitacion: r.lluviaConPrecipitacionEscalado / 10_000,
    lluvia_sin_precipitacion: r.lluviaSinPrecipitacionEscalado / 10_000,
    disponibilidad: r.disponibilidad.map((u) => ({
      hasta: u.hasta >= Number.MAX_SAFE_INTEGER ? null : u.hasta,
      multiplicador: u.multiplicadorEscalado / 10_000
    })),
    demanda_por_mil: r.demandaPorMil.map((u) => ({
      hasta: u.hasta >= Number.MAX_SAFE_INTEGER ? null : u.hasta,
      multiplicador: u.multiplicadorEscalado / 10_000
    })),
    horario: {
      MADRUGADA: r.horario.MADRUGADA / 10_000,
      MANANA: r.horario.MANANA / 10_000,
      SIESTA: r.horario.SIESTA / 10_000,
      TARDE: r.horario.TARDE / 10_000,
      NOCHE: r.horario.NOCHE / 10_000
    }
  };
}
function parsearSimulacion(valor: unknown): SimulacionTarifaInput {
  if (!objeto(valor)) {
    throw new ErrorTarifas("ENTRADA_INVALIDA", "El bloque de simulación debe ser un objeto JSON.");
  }
  const res: SimulacionTarifaInput = {};
  if (valor.hora !== undefined) {
    if (typeof valor.hora !== "number" || !Number.isInteger(valor.hora) || valor.hora < 0 || valor.hora > 23) {
      throw new ErrorTarifas("ENTRADA_INVALIDA", "La hora simulada debe ser un número entero entre 0 y 23.");
    }
    res.hora = valor.hora;
  }
  if (valor.franja_horaria !== undefined || valor.franjaHoraria !== undefined) {
    const rawFranja = String(valor.franja_horaria ?? valor.franjaHoraria).toUpperCase();
    if (!FRANJAS_HORARIAS.includes(rawFranja as FranjaHoraria)) {
      throw new ErrorTarifas("ENTRADA_INVALIDA", `Franja horaria simulada inválida: ${rawFranja}`);
    }
    res.franjaHoraria = rawFranja as FranjaHoraria;
  }
  if (valor.llueve !== undefined) {
    if (typeof valor.llueve !== "boolean") {
      throw new ErrorTarifas("ENTRADA_INVALIDA", "El campo llueve debe ser booleano.");
    }
    res.llueve = valor.llueve;
  }
  if (valor.precipitacion_mm !== undefined || valor.precipitacionMm !== undefined) {
    const mm = Number(valor.precipitacion_mm ?? valor.precipitacionMm);
    if (!Number.isFinite(mm) || mm < 0) {
      throw new ErrorTarifas("ENTRADA_INVALIDA", "La precipitación simulada debe ser un número mayor o igual a 0.");
    }
    res.precipitacionMm = mm;
  }
  if (valor.choferes_disponibles !== undefined || valor.choferesDisponibles !== undefined) {
    const ch = Number(valor.choferes_disponibles ?? valor.choferesDisponibles);
    if (!Number.isInteger(ch) || ch < 0) {
      throw new ErrorTarifas("ENTRADA_INVALIDA", "Los choferes disponibles simulados deben ser un entero >= 0.");
    }
    res.choferesDisponibles = ch;
  }
  if (valor.solicitudes_activas !== undefined || valor.solicitudesActivas !== undefined) {
    const sol = Number(valor.solicitudes_activas ?? valor.solicitudesActivas);
    if (!Number.isInteger(sol) || sol < 0) {
      throw new ErrorTarifas("ENTRADA_INVALIDA", "Las solicitudes activas simuladas deben ser un entero >= 0.");
    }
    res.solicitudesActivas = sol;
  }
  return res;
}

function dto(e: NonNullable<Awaited<ReturnType<RepositorioEstimaciones["obtener"]>>>) {
  const f = e.factoresPrecio;
  return { id_estimacion: e.id, precio_estimado: e.precioEstimado.toString(), moneda: e.moneda, distancia_metros: e.distanciaMetros, duracion_segundos: e.duracionSegundos,
    proveedor_ruta: e.proveedorRuta,
    multiplicador_demanda: e.multiplicadorDemandaEscalado / 10_000, zona: e.zona.nombre,
    factores_precio: { zona_id: e.zona.id, choferes_disponibles: f.choferesDisponibles, solicitudes_activas: f.solicitudesActivas, precipitacion_mm: f.precipitacionMm, llueve: f.llueve, fuente_clima: f.fuenteClima, clima_observado_en: f.climaObservadoEn.toISOString(), franja_horaria: f.franjaHoraria.toLowerCase(), factor_lluvia: f.factorLluviaEscalado / 10_000, factor_disponibilidad: f.factorDisponibilidadEscalado / 10_000, factor_demanda: f.factorDemandaEscalado / 10_000, factor_horario: f.factorHorarioEscalado / 10_000 },
    recomendaciones: e.recomendaciones ?? [],
    version_regla: e.versionRegla, creada_en: e.creadaEn.toISOString(), vigente_hasta: e.vigenteHasta.toISOString(), origen: e.origen, destino: e.destino, polilinea: e.polilinea ?? null };
}
export function crearRouterTarifas(deps: DependenciasTarifas): express.Router {
  const router = express.Router();
  router.get("/health", (_req, res) => res.json({ estado: "activo", servicio: "ms-tarifas" }));
  router.get("/ready", async (_req, res) => { try { await deps.comprobarBase(); res.json({ estado: "listo", servicio: "ms-tarifas" }); } catch { res.status(503).json({ estado: "no_listo", servicio: "ms-tarifas" }); } });
  router.use(express.json({ limit: "10kb" }));
  const autenticar = async (req: Request, res: Response, next: NextFunction) => {
    const token = req.header("Authorization")?.match(/^Bearer ([^ ]+)$/)?.[1];
    if (!token) { res.status(401).json({ error: { codigo: "TOKEN_REQUERIDO", mensaje: "Se requiere Authorization Bearer.", detalles: {} } }); return; }
    try { req.actor = await deps.validador.validar(token); next(); } catch { res.status(401).json({ error: { codigo: "TOKEN_INVALIDO", mensaje: "El token no es válido.", detalles: {} } }); }
  };
  router.post("/viajes/estimacion", autenticar, async (req, res) => {
    if (!["PASAJERO", "ADMINISTRADOR"].includes(req.actor?.rol ?? "")) { res.status(403).json({ error: { codigo: "ROL_NO_AUTORIZADO", mensaje: "Solo un pasajero o administrador puede solicitar una estimación.", detalles: {} } }); return; }
    if (!objeto(req.body) || Object.keys(req.body).some((key) => !["origen", "destino", "simulacion"].includes(key))) { res.status(400).json({ error: { codigo: "ENTRADA_INVALIDA", mensaje: "Se requieren origen y destino, sin campos de precio.", detalles: {} } }); return; }
    const origen = puntoUbicacion(req.body.origen); const destino = puntoUbicacion(req.body.destino);
    if (!origen || !destino || !req.actor) { res.status(400).json({ error: { codigo: "ENTRADA_INVALIDA", mensaje: "Origen y destino deben incluir coordenadas numéricas o una dirección válida.", detalles: {} } }); return; }

    let simulacion: SimulacionTarifaInput | undefined;
    if (req.body.simulacion !== undefined) {
      const modoDevActivo = deps.modoDesarrollador ?? (process.env.MODO_DESARROLLADOR === "true" && process.env.NODE_ENV !== "production");
      if (!modoDevActivo) {
        res.status(403).json({
          error: {
            codigo: "MODO_DESARROLLADOR_DESHABILITADO",
            mensaje: "La simulación de tarifas solo está permitida cuando MODO_DESARROLLADOR=true y fuera de producción.",
            detalles: {}
          }
        });
        return;
      }
      try {
        simulacion = parsearSimulacion(req.body.simulacion);
      } catch (causa) {
        error(res, causa);
        return;
      }
    }

    try { res.status(201).json(dto(await deps.estimar(req.actor.idUsuario, origen, destino, req.header("Authorization")!.slice(7), simulacion))); } catch (causa) { error(res, causa); }
  });
  router.get<{ idEstimacion: string }>("/estimaciones/:idEstimacion", autenticar, async (req, res) => {
    try {
      const e = await deps.estimaciones.obtener(req.params.idEstimacion);
      if (!e) { res.status(404).json({ error: { codigo: "ESTIMACION_NO_ENCONTRADA", mensaje: "No existe la estimación.", detalles: {} } }); return; }
      if (req.actor?.idUsuario !== e.pasajeroId && !["SOPORTE", "ADMINISTRADOR"].includes(req.actor?.rol ?? "")) { res.status(403).json({ error: { codigo: "ESTIMACION_NO_AUTORIZADA", mensaje: "No podés consultar esta estimación.", detalles: {} } }); return; }
      if (e.vigenteHasta.getTime() <= Date.now()) { res.status(409).json({ error: { codigo: "ESTIMACION_VENCIDA", mensaje: "La estimación ya venció.", detalles: {} } }); return; }
      res.json(dto(e));
    } catch (causa) { error(res, causa); }
  });
  router.get("/reglas/demanda", autenticar, async (req, res) => {
    if (req.actor?.rol !== "ADMINISTRADOR") {
      res.status(403).json({ error: { codigo: "ROL_NO_AUTORIZADO", mensaje: "Solo un administrador puede consultar la configuración de reglas de demanda.", detalles: {} } });
      return;
    }
    if (!deps.reglas) {
      res.status(500).json({ error: { codigo: "ERROR_INTERNO", mensaje: "La gestión de reglas de demanda no está configurada.", detalles: {} } });
      return;
    }
    try {
      const snapshot = await deps.reglas.consultar();
      res.json({ activa: reglaDto(snapshot.activa), historial: snapshot.historial.map(reglaDto) });
    } catch (causa) { error(res, causa); }
  });
  router.put("/reglas/demanda", autenticar, async (req, res) => {
    if (req.actor?.rol !== "ADMINISTRADOR" || !req.actor.idUsuario) {
      res.status(403).json({ error: { codigo: "ROL_NO_AUTORIZADO", mensaje: "Solo un administrador puede modificar las reglas de demanda.", detalles: {} } });
      return;
    }
    if (!deps.reglas) {
      res.status(500).json({ error: { codigo: "ERROR_INTERNO", mensaje: "La gestión de reglas de demanda no está configurada.", detalles: {} } });
      return;
    }
    try {
      const entrada = parsearReglaDemandaBody(req.body);
      const snapshot = await deps.reglas.actualizar(req.actor.idUsuario, entrada);
      res.json({ activa: reglaDto(snapshot.activa), historial: snapshot.historial.map(reglaDto) });
    } catch (causa) { error(res, causa); }
  });
  router.post("/tarifas/geocodificacion-inversa", autenticar, async (req, res) => {
    if (!["PASAJERO", "ADMINISTRADOR"].includes(req.actor?.rol ?? "")) {
      res.status(403).json({ error: { codigo: "ROL_NO_AUTORIZADO", mensaje: "Solo pasajeros o administración pueden resolver direcciones en el mapa.", detalles: {} } });
      return;
    }
    if (!objeto(req.body) || Object.keys(req.body).some((k) => k !== "latitud" && k !== "longitud") || typeof req.body.latitud !== "number" || typeof req.body.longitud !== "number") {
      res.status(400).json({ error: { codigo: "COORDENADAS_INVALIDAS", mensaje: "Indicá latitud y longitud numéricas válidas.", detalles: {} } });
      return;
    }
    try {
      const coordenada: Coordenada = { latitud: req.body.latitud, longitud: req.body.longitud };
      validarCoordenada(coordenada);
      const direccion = deps.geocodificarInversa
        ? await deps.geocodificarInversa(coordenada)
        : `Ubicación (${coordenada.latitud.toFixed(5)}, ${coordenada.longitud.toFixed(5)})`;
      res.json({ direccion, coordenada });
    } catch (causa) { error(res, causa); }
  });
  router.post("/tarifas/autocompletar", autenticar, async (req, res) => {
    if (!["PASAJERO", "ADMINISTRADOR"].includes(req.actor?.rol ?? "")) {
      res.status(403).json({ error: { codigo: "ROL_NO_AUTORIZADO", mensaje: "Solo pasajeros o administración pueden buscar sugerencias de direcciones.", detalles: {} } });
      return;
    }
    if (!objeto(req.body) || Object.keys(req.body).some((k) => k !== "consulta" && k !== "centro") || typeof req.body.consulta !== "string") {
      res.status(400).json({ error: { codigo: "ENTRADA_INVALIDA", mensaje: "Indicá una consulta de dirección válida.", detalles: {} } });
      return;
    }
    const consulta = req.body.consulta.trim();
    if (consulta.length < 2 || consulta.length > 150) {
      res.json({ sugerencias: [] });
      return;
    }
    let centro: Coordenada | undefined;
    if (req.body.centro !== undefined) {
      if (!objeto(req.body.centro) || typeof req.body.centro.latitud !== "number" || typeof req.body.centro.longitud !== "number") {
        res.status(400).json({ error: { codigo: "COORDENADAS_INVALIDAS", mensaje: "El centro de búsqueda debe incluir latitud y longitud numéricas válidas.", detalles: {} } });
        return;
      }
      centro = { latitud: req.body.centro.latitud, longitud: req.body.centro.longitud };
      try { validarCoordenada(centro); } catch (causa) { error(res, causa); return; }
    }
    try {
      const sugerencias = deps.autocompletar ? await deps.autocompletar(consulta, centro) : [];
      res.json({ sugerencias });
    } catch (causa) { error(res, causa); }
  });
  // Preserva el 401 actual para rutas desconocidas; las rutas válidas ya pasan
  // por autenticar después de que Express haya asignado req.route.
  router.use(autenticar);
  router.use(manejarErrorCuerpoHttp);
  return router;
}
