import "dotenv/config";
import express from "express";
import { iniciarObservabilidad, middlewareObservabilidad } from "../compartido/observabilidad";

iniciarObservabilidad("ms-flota");

import { randomUUID } from "node:crypto";
import { crearRouterFlota } from "./http";
import {
  AutorizadorUbicacionBasico,
  PurgarUbicacionesHistoricasVencidas,
  RepositorioChoferesMemoria,
  RepositorioUbicacionesMemoria,
  RepositorioVehiculosMemoria,
  RepositorioViajesActivosMemoria
} from "./dominio";
import {
  crearPoolPostgres,
  RepositorioChoferesPostgres,
  RepositorioUbicacionesPostgres,
  RepositorioVehiculosPostgres
} from "./postgres";
import { crearValidadorJwtDesdeEntorno } from "../compartido/jwt-falso";
import { ClienteServiciosHttp, exigirBaseInterna } from "../compartido/cliente-servicios";
import { RepositorioViajesActivosHttp } from "./viajes-http";
import { iniciarMedicionProcesoFlota } from "./mediciones";
import { NotificadorUbicacionViajesHttp } from "./notificador-viajes-http";
import { registrarLogEstructurado } from "../compartido/observabilidad";

const puerto = Number(process.env.PUERTO_MS_FLOTA ?? 3002);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error("PUERTO_MS_FLOTA debe ser un entero entre 1 y 65535.");

const pool = process.env.DATABASE_URL ? crearPoolPostgres() : undefined;
const detenerMedicionProceso = iniciarMedicionProcesoFlota();
const posiciones = new Map();
const choferes = pool ? new RepositorioChoferesPostgres(pool) : new RepositorioChoferesMemoria(posiciones);
const ubicaciones = pool ? new RepositorioUbicacionesPostgres(pool, randomUUID) : new RepositorioUbicacionesMemoria(posiciones);
const vehiculos = pool ? new RepositorioVehiculosPostgres(pool) : new RepositorioVehiculosMemoria();
const validador = crearValidadorJwtDesdeEntorno();
const aplicacion = express();
aplicacion.use(middlewareObservabilidad("ms-flota"));

aplicacion.get("/health", (_pedido, respuesta) => respuesta.json({ estado: "activo", servicio: "ms-flota" }));
aplicacion.get("/ready", async (_pedido, respuesta) => {
  if (!pool) { respuesta.status(503).json({ estado: "no_listo", servicio: "ms-flota", motivo: "DATABASE_URL ausente" }); return; }
  try { await pool.query("SELECT 1"); respuesta.json({ estado: "listo", servicio: "ms-flota" }); }
  catch { respuesta.status(503).json({ estado: "no_listo", servicio: "ms-flota", motivo: "PostgreSQL no disponible" }); }
});
const urlViajes = exigirBaseInterna(process.env.MS_VIAJES_URL, "MS_VIAJES_URL");
const clienteInterno = new ClienteServiciosHttp({ timeoutMs: Number(process.env.TIMEOUT_SERVICIO_MS ?? 1500), reintentos: Number(process.env.REINTENTOS_SERVICIO ?? 1) });
aplicacion.use(crearRouterFlota({
  choferes,
  ubicaciones,
  vehiculos,
  viajes: new RepositorioViajesActivosMemoria(),
  crearRepositorioViajes: (jwt) => new RepositorioViajesActivosHttp(urlViajes, jwt, clienteInterno),
  validadorToken: validador,
  autorizador: new AutorizadorUbicacionBasico(),
  publicadorUbicacionViaje: new NotificadorUbicacionViajesHttp(urlViajes, Number(process.env.TIMEOUT_SERVICIO_MS ?? "1500"))
}));

const diasRetencion = Number(process.env.DIAS_RETENCION_UBICACIONES ?? "60");
const intervaloLimpiezaMs = Number(process.env.INTERVALO_LIMPIEZA_UBICACIONES_MS ?? "3600000");
const purgarRetencion = new PurgarUbicacionesHistoricasVencidas(ubicaciones, Number.isFinite(diasRetencion) && diasRetencion > 0 ? diasRetencion : 60);
let limpiezaEnCurso = false;
const ejecutarLimpiezaRetencion = () => {
  if (limpiezaEnCurso) return;
  limpiezaEnCurso = true;
  void purgarRetencion.ejecutar()
    .then((res) => {
      if (res.eliminados > 0) {
        registrarLogEstructurado({ evento: "retencion_ubicaciones_ejecutada", servicio: "ms-flota", resultado: String(res.eliminados) });
      }
    })
    .catch(() => undefined)
    .finally(() => { limpiezaEnCurso = false; });
};
const intervaloLimpieza = Number.isFinite(intervaloLimpiezaMs) && intervaloLimpiezaMs > 0
  ? setInterval(ejecutarLimpiezaRetencion, intervaloLimpiezaMs)
  : undefined;
intervaloLimpieza?.unref();

const servidor = aplicacion.listen(puerto, () => {
  console.log(`ms-flota disponible en http://localhost:${puerto}`);
  ejecutarLimpiezaRetencion();
});
async function cerrar(): Promise<void> {
  if (intervaloLimpieza) clearInterval(intervaloLimpieza);
  detenerMedicionProceso();
  servidor.close();
  await pool?.end();
}
process.once("SIGTERM", () => { void cerrar(); });
process.once("SIGINT", () => { void cerrar(); });
