import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { iniciarObservabilidad, middlewareObservabilidad } from "../compartido/observabilidad";

iniciarObservabilidad("ms-viajes");

import { crearValidadorJwtDesdeEntorno, ValidadorJwtFalso } from "../compartido/jwt-falso";
import {
  AceptarOferta, AsignadorAtomicoMemoria, AvanzarViaje, CancelarViaje, ConsultarCobro, ConsultarOfertasChofer, ConfirmarViaje,
  ConsultarAuditoriaTarifa, ConsultarChoferesOcupados, ConsultarDemandaPorZona, ConsultarViaje, CrearOfertasParaCandidatos, FinalizarViaje, GeneradorIdMemoria, ListarViajesOperador, ProcesarVencimientoOfertas, PublicarEstadoViaje, PublicarUbicacionChoferEnViaje, RechazarOferta, ReintentarCobro,
  MarcarViajeSinChoferesDisponibles,
  RepositorioCobrosMemoria, RepositorioIdempotenciaMemoria, RepositorioOfertasMemoria,
  RepositorioViajesMemoria, type ActorAutenticado, type EstimacionVigente
} from "./dominio";
import {
  AsignadorAtomicoPostgres,
  ConsultarChoferesOcupadosPostgres,
  ConsultarDemandaPorZonaPostgres,
  crearPoolPostgres,
  EjecutorIdempotentePostgres,
  GeneradorIdUuid,
  RepositorioCobrosPostgres,
  RepositorioIdempotenciaPostgres,
  RepositorioOfertasPostgres,
  RepositorioViajesPostgres,
  TransaccionesViajesPostgres
} from "./postgres";
import { crearRouterViajes } from "./http";
import { ClienteServiciosHttp, exigirBaseInterna } from "../compartido/cliente-servicios";
import { ClienteFlotaHttp, ClienteTarifasHttp } from "./clientes-http";
import { ConfirmarViajeYBuscarChoferes } from "./integracion";
import { AdaptadorWebSocketTiempoReal } from "./tiempo-real";
import { PasarelaPagosFalsa } from "./pasarela-pagos-falsa";

const puerto = Number(process.env.PUERTO_MS_VIAJES ?? 3000);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error("PUERTO_MS_VIAJES debe ser un entero entre 1 y 65535.");
const token = crearValidadorJwtDesdeEntorno();
const aplicacion = express();
const servidor = createServer(aplicacion);
const eventosTiempoReal = new AdaptadorWebSocketTiempoReal(servidor, token);

const pool = process.env.DATABASE_URL ? crearPoolPostgres(process.env) : undefined;

const viajes = pool ? new RepositorioViajesPostgres(pool) : new RepositorioViajesMemoria();
const ofertas = pool ? new RepositorioOfertasPostgres(pool) : new RepositorioOfertasMemoria();
const cobros = pool ? new RepositorioCobrosPostgres(pool) : new RepositorioCobrosMemoria();
const idempotencia = pool ? new RepositorioIdempotenciaPostgres(pool) : new RepositorioIdempotenciaMemoria();
const asignador = pool ? new AsignadorAtomicoPostgres(pool) : new AsignadorAtomicoMemoria();
const transaccionViajes = pool ? new TransaccionesViajesPostgres(pool) : undefined;
const ejecutorIdempotente = pool ? new EjecutorIdempotentePostgres(pool) : undefined;
const ids = pool ? new GeneradorIdUuid() : new GeneradorIdMemoria();
const pasarelaPagos = new PasarelaPagosFalsa();

const timeoutServicio = Number(process.env.TIMEOUT_SERVICIO_MS ?? "1500");
const reintentosServicio = Number(process.env.REINTENTOS_SERVICIO ?? "1");
const clienteHttp = new ClienteServiciosHttp({ timeoutMs: timeoutServicio, reintentos: reintentosServicio });
const clienteTarifas = new ClienteTarifasHttp(exigirBaseInterna(process.env.MS_TARIFAS_URL, "MS_TARIFAS_URL"), clienteHttp);
const clienteFlota = new ClienteFlotaHttp(exigirBaseInterna(process.env.MS_FLOTA_URL, "MS_FLOTA_URL"), clienteHttp, Number(process.env.RADIO_BUSQUEDA_CHOFERES_METROS ?? "5000"));

const ofertasPorRonda = Number(process.env.OFERTAS_POR_RONDA ?? "1");
const vigenciaOfertaMs = Number(process.env.VIGENCIA_OFERTA_MS ?? "30000");
const intervaloVencimientoMs = Number(process.env.INTERVALO_VENCIMIENTO_OFERTAS_MS ?? "5000");

let tokenSistemaCache: { token: string; venceEnMs: number } | undefined;
async function obtenerTokenSistema(): Promise<string> {
  if (tokenSistemaCache && tokenSistemaCache.venceEnMs > Date.now() + 15_000) {
    return tokenSistemaCache.token;
  }
  if (process.env.JWT_MODO === "falso") {
    const tokenFalso = new ValidadorJwtFalso().generar({ idUsuario: "sistema-viajes", rol: "ADMINISTRADOR" });
    tokenSistemaCache = { token: tokenFalso, venceEnMs: Date.now() + 300_000 };
    return tokenFalso;
  }
  const baseAuth = process.env.AUTH_EMULATOR_URL || (process.env.JWT_JWKS_URL ? new URL(process.env.JWT_JWKS_URL).origin : "");
  if (!baseAuth) throw new Error("No hay origen de tokens de sistema configurado para reofertar viajes.");
  const respuesta = await fetch(`${baseAuth}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_usuario: "sistema-viajes", rol: "administrador", expira_en_segundos: 300 }),
    signal: AbortSignal.timeout(timeoutServicio)
  });
  if (!respuesta.ok) throw new Error(`No se pudo emitir token de sistema (${respuesta.status}).`);
  const datos = (await respuesta.json()) as { token?: string };
  if (!datos.token) throw new Error("El proveedor no devolvió un token de sistema.");
  tokenSistemaCache = { token: datos.token, venceEnMs: Date.now() + 240_000 };
  return datos.token;
}

const confirmar = new ConfirmarViaje(viajes, idempotencia, ids, ejecutorIdempotente);
const crearOfertas = new CrearOfertasParaCandidatos(ofertas, ids);
const sinChoferesDisponibles = new MarcarViajeSinChoferesDisponibles(viajes);
const confirmarConOfertas = new ConfirmarViajeYBuscarChoferes(confirmar, clienteFlota, crearOfertas, sinChoferesDisponibles, eventosTiempoReal, {
  maxOfertasPorRonda: Number.isFinite(ofertasPorRonda) && ofertasPorRonda > 0 ? ofertasPorRonda : undefined,
  vigenciaMs: Number.isFinite(vigenciaOfertaMs) && vigenciaOfertaMs > 0 ? vigenciaOfertaMs : 30_000
});
const procesarVencimientos = new ProcesarVencimientoOfertas(
  ofertas,
  viajes,
  crearOfertas,
  sinChoferesDisponibles,
  async (viaje) => clienteFlota.buscar(viaje.origen, await obtenerTokenSistema()),
  eventosTiempoReal,
  {
    maxOfertasPorRonda: Number.isFinite(ofertasPorRonda) && ofertasPorRonda > 0 ? ofertasPorRonda : undefined,
    vigenciaMs: Number.isFinite(vigenciaOfertaMs) && vigenciaOfertaMs > 0 ? vigenciaOfertaMs : 30_000
  }
);

const consultarDemanda = pool ? new ConsultarDemandaPorZonaPostgres(pool) : new ConsultarDemandaPorZona(viajes);
const consultarOcupacion = pool ? new ConsultarChoferesOcupadosPostgres(pool) : new ConsultarChoferesOcupados(viajes);
const publicarEstado = new PublicarEstadoViaje(eventosTiempoReal);
const publicarUbicacion = new PublicarUbicacionChoferEnViaje(viajes, eventosTiempoReal);

const dependencias = {
  viajes, ofertas,
  confirmar,
  confirmarConOfertas: (actor: ActorAutenticado, estimacion: EstimacionVigente, clave: string, jwt: string) => confirmarConOfertas.ejecutar(actor, estimacion, clave, jwt),
  aceptar: new AceptarOferta(ofertas, viajes, asignador, eventosTiempoReal, transaccionViajes),
  rechazar: new RechazarOferta(ofertas),
  cancelar: new CancelarViaje(viajes, asignador, ofertas, eventosTiempoReal),
  avanzar: new AvanzarViaje(viajes),
  finalizar: new FinalizarViaje(viajes, cobros, asignador, ids, pasarelaPagos),
  consultarCobro: new ConsultarCobro(viajes, cobros),
  reintentarCobro: new ReintentarCobro(viajes, cobros, idempotencia, pasarelaPagos),
  consultar: new ConsultarViaje(viajes),
  listarViajesOperador: new ListarViajesOperador(viajes),
  auditoriaTarifa: new ConsultarAuditoriaTarifa(viajes),
  validadorToken: token,
  obtenerEstimacion: (_actor: ActorAutenticado, id: string, jwt: string) => clienteTarifas.obtenerEstimacion(id, jwt),
  consultarDemanda,
  consultarOcupacion,
  eventosTiempoReal,
  publicarEstado,
  publicarUbicacion,
  consultarOfertas: new ConsultarOfertasChofer(ofertas, eventosTiempoReal),
  procesarSiguienteTrasRechazo: async (viajeId: string) => {
    await procesarVencimientos.intentarSiguienteParaViaje(viajeId);
  }
};

aplicacion.use(middlewareObservabilidad("ms-viajes"));
aplicacion.get("/health", (_pedido, respuesta) => respuesta.json({ estado: "activo", servicio: "ms-viajes" }));
aplicacion.get("/ready", async (_pedido, respuesta) => {
  if (pool) {
    try {
      await pool.query("SELECT 1");
      return void respuesta.json({ estado: "listo", servicio: "ms-viajes", persistencia: "postgresql" });
    } catch {
      return void respuesta.status(503).json({
        estado: "no_listo",
        servicio: "ms-viajes",
        dependencias: { base_datos: "no_disponible" }
      });
    }
  }
  respuesta.json({ estado: "listo", servicio: "ms-viajes", persistencia: "memoria" });
});
aplicacion.use(crearRouterViajes(dependencias));

servidor.listen(puerto, () => console.log(`ms-viajes disponible en http://localhost:${puerto}`));

let barridoEnCurso = false;
const intervaloVencimientos = Number.isFinite(intervaloVencimientoMs) && intervaloVencimientoMs > 0
  ? setInterval(() => {
    if (barridoEnCurso) return;
    barridoEnCurso = true;
    void procesarVencimientos.ejecutar().catch(() => undefined).finally(() => {
      barridoEnCurso = false;
    });
  }, intervaloVencimientoMs)
  : undefined;
intervaloVencimientos?.unref();

async function cerrar(): Promise<void> {
  if (intervaloVencimientos) clearInterval(intervaloVencimientos);
  await eventosTiempoReal.cerrar();
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
  await pool?.end();
}

process.once("SIGTERM", () => { void cerrar(); });
process.once("SIGINT", () => { void cerrar(); });
