import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { crearPoolTarifas, RepositorioEstimacionesPostgres, RepositorioReglasPostgres, RepositorioZonasPostgres } from "./postgres";
import { CrearEstimacion } from "./dominio";
import { FuenteClimaOpenMeteo, FuenteDemandaHttp, FuenteFlotaHttp, crearCalculadorRuta } from "./proveedores";
import { ValidadorJwtJwks } from "../compartido/jwt";
import { crearRouterTarifas } from "./http";

const puerto = Number(process.env.PUERTO_MS_TARIFAS ?? "3001");
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error("PUERTO_MS_TARIFAS debe ser un entero entre 1 y 65535.");
const pool = crearPoolTarifas();
const estimaciones = new RepositorioEstimacionesPostgres(pool);
const validador = new ValidadorJwtJwks({ jwksUrl: requerido("JWT_JWKS_URL"), emisor: requerido("JWT_ISSUER"), audiencia: requerido("JWT_AUDIENCE"), campoRol: process.env.JWT_ROLE_CLAIM ?? "rol" });
const crear = (pasajeroId: string, origen: { latitud: number; longitud: number }, destino: { latitud: number; longitud: number }, token: string) => {
  return new CrearEstimacion(crearCalculadorRuta(), new FuenteClimaOpenMeteo(), new FuenteFlotaHttp(process.env.MS_FLOTA_URL ?? "http://ms-flota:3002", token), new FuenteDemandaHttp(process.env.MS_VIAJES_URL ?? "http://ms-viajes:3000", token), new RepositorioZonasPostgres(pool), new RepositorioReglasPostgres(pool), estimaciones, { generar: randomUUID }).ejecutar(pasajeroId, origen, destino);
};
const app = express();
app.use(crearRouterTarifas({ estimar: crear, estimaciones, validador, comprobarBase: async () => { await pool.query("SELECT 1"); } }));
app.listen(puerto, () => console.log(`ms-tarifas disponible en puerto ${puerto}`));
function requerido(nombre: string): string { const valor = process.env[nombre]; if (!valor) throw new Error(`${nombre} es obligatoria.`); return valor; }
