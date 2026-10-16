import "dotenv/config";
import express from "express";
import { crearRouterFlota, type ValidadorToken } from "./http";
import { AutorizadorUbicacionBasico, RepositorioChoferesMemoria, RepositorioUbicacionesMemoria, RepositorioViajesActivosMemoria } from "./dominio";

class ValidadorTokenConfigurado implements ValidadorToken {
  async validar(_token: string): Promise<never> { throw new Error("El validador JWT externo aún no está configurado."); }
}

const puerto = Number(process.env.PUERTO_MS_FLOTA ?? 3002);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error("PUERTO_MS_FLOTA debe ser un entero entre 1 y 65535.");
const posiciones = new Map();
const choferes = new RepositorioChoferesMemoria(posiciones);
const ubicaciones = new RepositorioUbicacionesMemoria(posiciones);
const aplicacion = express();
aplicacion.get("/health", (_pedido, respuesta) => respuesta.json({ estado: "activo", servicio: "ms-flota" }));
aplicacion.use(crearRouterFlota({ choferes, ubicaciones, viajes: new RepositorioViajesActivosMemoria(), validadorToken: new ValidadorTokenConfigurado(), autorizador: new AutorizadorUbicacionBasico() }));
aplicacion.listen(puerto, () => console.log(`ms-flota disponible en http://localhost:${puerto}`));
