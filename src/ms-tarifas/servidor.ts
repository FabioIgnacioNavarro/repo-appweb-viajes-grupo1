import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { crearPoolTarifas, RepositorioEstimacionesPostgres, RepositorioReglasPostgres, RepositorioZonasPostgres } from "./postgres";
import { CrearEstimacion } from "./dominio";
import { FuenteClimaFalsa, FuenteClimaOpenMeteo, FuenteDemandaHttp, FuenteFlotaHttp, crearCalculadorRuta } from "./proveedores";
import { ValidadorJwtJwks } from "../compartido/jwt";
import { ValidadorJwtFalso } from "../compartido/jwt-falso";
import { exigirBaseInterna } from "../compartido/cliente-servicios";
import { crearRouterTarifas } from "./http";

const puerto = Number(process.env.PUERTO_MS_TARIFAS ?? "3001");
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error("PUERTO_MS_TARIFAS debe ser un entero entre 1 y 65535.");
const pool = crearPoolTarifas();
const estimaciones = new RepositorioEstimacionesPostgres(pool);
const validador = crearValidador();
const timeoutServicio = Number(process.env.TIMEOUT_SERVICIO_MS ?? "1500");
const timeoutProveedor = Number(process.env.TIMEOUT_PROVEEDOR_MS ?? "1800");
const reintentos = Number(process.env.REINTENTOS_SERVICIO ?? "1");
if (!Number.isInteger(timeoutServicio) || timeoutServicio < 1 || !Number.isInteger(timeoutProveedor) || timeoutProveedor < 1 || !Number.isInteger(reintentos) || reintentos < 0 || reintentos > 1) throw new Error("Los timeouts o reintentos configurados son inválidos.");
const urlFlota = exigirBaseInterna(process.env.MS_FLOTA_URL, "MS_FLOTA_URL");
const urlViajes = exigirBaseInterna(process.env.MS_VIAJES_URL, "MS_VIAJES_URL");
const crear = (pasajeroId: string, origen: { latitud: number; longitud: number }, destino: { latitud: number; longitud: number }, token: string) => {
  const clima = process.env.PROVEEDORES_MODO === "falso" ? new FuenteClimaFalsa() : new FuenteClimaOpenMeteo(timeoutProveedor);
  return new CrearEstimacion(crearCalculadorRuta(process.env, timeoutProveedor), clima, new FuenteFlotaHttp(urlFlota, token, timeoutServicio, fetch, reintentos), new FuenteDemandaHttp(urlViajes, token, timeoutServicio, fetch, reintentos), new RepositorioZonasPostgres(pool), new RepositorioReglasPostgres(pool), estimaciones, { generar: randomUUID }).ejecutar(pasajeroId, origen, destino);
};
const app = express();
app.use(crearRouterTarifas({ estimar: crear, estimaciones, validador, comprobarBase: async () => { await pool.query("SELECT 1"); } }));
app.listen(puerto, () => console.log(`ms-tarifas disponible en puerto ${puerto}`));
function requerido(nombre: string): string { const valor = process.env[nombre]; if (!valor) throw new Error(`${nombre} es obligatoria.`); return valor; }
function crearValidador() {
  if (process.env.JWT_MODO === "falso") {
    if (process.env.NODE_ENV === "production") throw new Error("JWT_MODO=falso no está permitido en producción.");
    return new ValidadorJwtFalso();
  }
  return new ValidadorJwtJwks({ jwksUrl: requerido("JWT_JWKS_URL"), emisor: requerido("JWT_ISSUER"), audiencia: requerido("JWT_AUDIENCE"), campoRol: process.env.JWT_ROLE_CLAIM ?? "rol" });
}
