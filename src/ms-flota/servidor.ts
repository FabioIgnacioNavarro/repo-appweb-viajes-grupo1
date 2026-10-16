import "dotenv/config";
import express from "express";
import { crearRouterFlota, type ValidadorToken } from "./http";
import { AutorizadorUbicacionBasico, RepositorioChoferesMemoria, RepositorioUbicacionesMemoria, RepositorioViajesActivosMemoria } from "./dominio";
import { ValidadorJwtJwks } from "../compartido/jwt";

const puerto = Number(process.env.PUERTO_MS_FLOTA ?? 3002);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error("PUERTO_MS_FLOTA debe ser un entero entre 1 y 65535.");
const posiciones = new Map();
const choferes = new RepositorioChoferesMemoria(posiciones);
const ubicaciones = new RepositorioUbicacionesMemoria(posiciones);
const poolUrl = process.env.DATABASE_URL;
const validador = new ValidadorJwtJwks({ jwksUrl: requerido("JWT_JWKS_URL"), emisor: requerido("JWT_ISSUER"), audiencia: requerido("JWT_AUDIENCE"), campoRol: process.env.JWT_ROLE_CLAIM ?? "rol" });
const aplicacion = express();
aplicacion.get("/health", (_pedido, respuesta) => respuesta.json({ estado: "activo", servicio: "ms-flota" }));
aplicacion.get("/ready", (_pedido, respuesta) => respuesta.status(poolUrl ? 200 : 503).json({ estado: poolUrl ? "listo" : "no_listo", servicio: "ms-flota" }));
aplicacion.use(crearRouterFlota({ choferes, ubicaciones, viajes: new RepositorioViajesActivosMemoria(), validadorToken: validador, autorizador: new AutorizadorUbicacionBasico() }));
aplicacion.listen(puerto, () => console.log(`ms-flota disponible en http://localhost:${puerto}`));
function requerido(nombre: string): string { const valor = process.env[nombre]; if (!valor) throw new Error(`${nombre} es obligatoria.`); return valor; }
