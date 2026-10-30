import "dotenv/config";
import express from "express";
import { iniciarObservabilidad, middlewareObservabilidad } from "../compartido/observabilidad";

iniciarObservabilidad("ms-viajes");

import { ValidadorJwtJwks } from "../compartido/jwt";
import { ValidadorJwtFalso } from "../compartido/jwt-falso";
import {
  AceptarOferta, AsignadorAtomicoMemoria, AvanzarViaje, CancelarViaje, ConfirmarViaje,
  ConsultarChoferesOcupados, ConsultarDemandaPorZona, ConsultarViaje, CrearOfertasParaCandidatos, FinalizarViaje, GeneradorIdMemoria, RechazarOferta,
  RepositorioCobrosMemoria, RepositorioIdempotenciaMemoria, RepositorioOfertasMemoria,
  RepositorioViajesMemoria, type ActorAutenticado, type EstimacionVigente
} from "./dominio";
import {
  AsignadorAtomicoPostgres,
  ConsultarChoferesOcupadosPostgres,
  ConsultarDemandaPorZonaPostgres,
  crearPoolPostgres,
  RepositorioCobrosPostgres,
  RepositorioIdempotenciaPostgres,
  RepositorioOfertasPostgres,
  RepositorioViajesPostgres
} from "./postgres";
import { crearRouterViajes } from "./http";
import { ClienteServiciosHttp, exigirBaseInterna } from "../compartido/cliente-servicios";
import { ClienteFlotaHttp, ClienteTarifasHttp } from "./clientes-http";
import { ConfirmarViajeYBuscarChoferes } from "./integracion";

const puerto = Number(process.env.PUERTO_MS_VIAJES ?? 3000);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error("PUERTO_MS_VIAJES debe ser un entero entre 1 y 65535.");
const requerido = (nombre: string): string => { const valor = process.env[nombre]; if (!valor) throw new Error(`${nombre} es obligatoria.`); return valor; };
const token = process.env.JWT_MODO === "falso"
  ? new ValidadorJwtFalso()
  : new ValidadorJwtJwks({ jwksUrl: requerido("JWT_JWKS_URL"), emisor: requerido("JWT_ISSUER"), audiencia: requerido("JWT_AUDIENCE"), campoRol: process.env.JWT_ROLE_CLAIM ?? "rol" });

const pool = process.env.DATABASE_URL ? crearPoolPostgres(process.env) : undefined;

const viajes = pool ? new RepositorioViajesPostgres(pool) : new RepositorioViajesMemoria();
const ofertas = pool ? new RepositorioOfertasPostgres(pool) : new RepositorioOfertasMemoria();
const cobros = pool ? new RepositorioCobrosPostgres(pool) : new RepositorioCobrosMemoria();
const idempotencia = pool ? new RepositorioIdempotenciaPostgres(pool) : new RepositorioIdempotenciaMemoria();
const asignador = pool ? new AsignadorAtomicoPostgres(pool) : new AsignadorAtomicoMemoria();
const ids = new GeneradorIdMemoria();

const timeoutServicio = Number(process.env.TIMEOUT_SERVICIO_MS ?? "1500");
const reintentosServicio = Number(process.env.REINTENTOS_SERVICIO ?? "1");
const clienteHttp = new ClienteServiciosHttp({ timeoutMs: timeoutServicio, reintentos: reintentosServicio });
const clienteTarifas = new ClienteTarifasHttp(exigirBaseInterna(process.env.MS_TARIFAS_URL, "MS_TARIFAS_URL"), clienteHttp);
const clienteFlota = new ClienteFlotaHttp(exigirBaseInterna(process.env.MS_FLOTA_URL, "MS_FLOTA_URL"), clienteHttp, Number(process.env.RADIO_BUSQUEDA_CHOFERES_METROS ?? "5000"));

const confirmar = new ConfirmarViaje(viajes, idempotencia, ids);
const confirmarConOfertas = new ConfirmarViajeYBuscarChoferes(confirmar, clienteFlota, new CrearOfertasParaCandidatos(ofertas, ids));

const consultarDemanda = pool ? new ConsultarDemandaPorZonaPostgres(pool) : new ConsultarDemandaPorZona(viajes);
const consultarOcupacion = pool ? new ConsultarChoferesOcupadosPostgres(pool) : new ConsultarChoferesOcupados(viajes);

const dependencias = {
  viajes, ofertas,
  confirmar,
  confirmarConOfertas: (actor: ActorAutenticado, estimacion: EstimacionVigente, clave: string, jwt: string) => confirmarConOfertas.ejecutar(actor, estimacion, clave, jwt),
  aceptar: new AceptarOferta(ofertas, viajes, asignador),
  rechazar: new RechazarOferta(ofertas),
  cancelar: new CancelarViaje(viajes, asignador),
  avanzar: new AvanzarViaje(viajes),
  finalizar: new FinalizarViaje(viajes, cobros, asignador, ids),
  consultar: new ConsultarViaje(viajes),
  validadorToken: token,
  obtenerEstimacion: (_actor: ActorAutenticado, id: string, jwt: string) => clienteTarifas.obtenerEstimacion(id, jwt),
  consultarDemanda,
  consultarOcupacion
};

const aplicacion = express();
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

const servidor = aplicacion.listen(puerto, () => console.log(`ms-viajes disponible en http://localhost:${puerto}`));

async function cerrar(): Promise<void> {
  servidor.close();
  await pool?.end();
}

process.once("SIGTERM", () => { void cerrar(); });
process.once("SIGINT", () => { void cerrar(); });
