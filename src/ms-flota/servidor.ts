import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { crearRouterFlota } from "./http";
import type { ValidadorToken } from "../compartido/jwt";
import { AutorizadorUbicacionBasico, RepositorioChoferesMemoria, RepositorioUbicacionesMemoria, RepositorioViajesActivosMemoria } from "./dominio";
import { crearPoolPostgres, RepositorioChoferesPostgres, RepositorioUbicacionesPostgres } from "./postgres";
import { ValidadorJwtFalso } from "../compartido/jwt-falso";
import { ValidadorJwtJwks } from "../compartido/jwt";
import { ClienteServiciosHttp, exigirBaseInterna } from "../compartido/cliente-servicios";
import { RepositorioViajesActivosHttp } from "./viajes-http";

const puerto = Number(process.env.PUERTO_MS_FLOTA ?? 3002);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error("PUERTO_MS_FLOTA debe ser un entero entre 1 y 65535.");

const pool = process.env.DATABASE_URL ? crearPoolPostgres() : undefined;
const posiciones = new Map();
const choferes = pool ? new RepositorioChoferesPostgres(pool) : new RepositorioChoferesMemoria(posiciones);
const ubicaciones = pool ? new RepositorioUbicacionesPostgres(pool, randomUUID) : new RepositorioUbicacionesMemoria(posiciones);
const validador = crearValidador();
const aplicacion = express();

aplicacion.get("/health", (_pedido, respuesta) => respuesta.json({ estado: "activo", servicio: "ms-flota" }));
aplicacion.get("/ready", async (_pedido, respuesta) => {
  if (!pool) { respuesta.status(503).json({ estado: "no_listo", servicio: "ms-flota", motivo: "DATABASE_URL ausente" }); return; }
  try { await pool.query("SELECT 1"); respuesta.json({ estado: "listo", servicio: "ms-flota" }); }
  catch { respuesta.status(503).json({ estado: "no_listo", servicio: "ms-flota", motivo: "PostgreSQL no disponible" }); }
});
const urlViajes = exigirBaseInterna(process.env.MS_VIAJES_URL, "MS_VIAJES_URL");
const clienteInterno = new ClienteServiciosHttp({ timeoutMs: Number(process.env.TIMEOUT_SERVICIO_MS ?? 1500), reintentos: Number(process.env.REINTENTOS_SERVICIO ?? 1) });
aplicacion.use(crearRouterFlota({ choferes, ubicaciones, viajes: new RepositorioViajesActivosMemoria(), crearRepositorioViajes: (jwt) => new RepositorioViajesActivosHttp(urlViajes, jwt, clienteInterno), validadorToken: validador, autorizador: new AutorizadorUbicacionBasico() }));

const servidor = aplicacion.listen(puerto, () => console.log(`ms-flota disponible en http://localhost:${puerto}`));
async function cerrar(): Promise<void> { servidor.close(); await pool?.end(); }
process.once("SIGTERM", () => { void cerrar(); });
process.once("SIGINT", () => { void cerrar(); });

function crearValidador(): ValidadorToken {
  if (process.env.JWT_MODO === "falso") {
    if (process.env.NODE_ENV === "production") throw new Error("JWT_MODO=falso no está permitido en producción.");
    return new ValidadorJwtFalso();
  }
  return new ValidadorJwtJwks({ jwksUrl: requerido("JWT_JWKS_URL"), emisor: requerido("JWT_ISSUER"), audiencia: requerido("JWT_AUDIENCE"), campoRol: process.env.JWT_ROLE_CLAIM ?? "rol" });
}
function requerido(nombre: string): string { const valor = process.env[nombre]; if (!valor) throw new Error(`${nombre} es obligatoria cuando JWT_MODO no es falso.`); return valor; }
