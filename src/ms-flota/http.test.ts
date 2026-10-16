import express from "express";
import { createServer, type Server } from "node:http";
import { strict as assert } from "node:assert";
import test from "node:test";
import { ValidadorJwtFalso } from "../compartido/jwt-falso";
import { AutorizadorUbicacionBasico, ErrorFlota, RepositorioChoferesMemoria, RepositorioUbicacionesMemoria, RepositorioViajesActivosMemoria, type Chofer } from "./dominio";
import { crearRouterFlota, type DependenciasFlota } from "./http";

async function iniciar(deps: DependenciasFlota): Promise<{ base: string; server: Server }> {
  const app = express(); app.use(crearRouterFlota(deps));
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Sin dirección de test.");
  return { base: `http://127.0.0.1:${address.port}`, server };
}
async function terminar(server: Server): Promise<void> { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
function datos(): { deps: DependenciasFlota; tokens: ValidadorJwtFalso; ocupados: RepositorioViajesActivosMemoria } {
  const tokens = new ValidadorJwtFalso(); const posiciones = new Map();
  const choferes = new RepositorioChoferesMemoria(posiciones); const ubicaciones = new RepositorioUbicacionesMemoria(posiciones); const ocupados = new RepositorioViajesActivosMemoria();
  const ahora = new Date(); const id = "chofer-disponible";
  const perfil: Chofer = { id: "perfil", usuarioId: id, habilitado: true, disponibilidad: true, carnetConducirValidado: true, fechaCreacion: ahora, fechaActualizacion: ahora };
  void choferes.guardar(perfil);
  void ubicaciones.guardarSiEsMasNueva({ id: "ubicacion", usuarioId: id, latitud: -27.45, longitud: -58.98, actualizadoAt: ahora });
  return { tokens, ocupados, deps: { choferes, ubicaciones, viajes: ocupados, validadorToken: tokens, autorizador: new AutorizadorUbicacionBasico() } };
}

test("ms-flota devuelve candidatos y entrega el JWT original al adaptador de ocupación", async () => {
  const ctx = datos(); const jwt = ctx.tokens.generar({ idUsuario: "pasajero-1", rol: "PASAJERO" }); let recibido = "";
  ctx.deps.crearRepositorioViajes = (token) => { recibido = token; return ctx.ocupados; };
  const { base, server } = await iniciar(ctx.deps);
  try {
    const respuesta = await fetch(`${base}/choferes/cercanos?latitud=-27.45&longitud=-58.98&radio_metros=500`, { headers: { Authorization: `Bearer ${jwt}` } });
    assert.equal(respuesta.status, 200);
    assert.equal(recibido, jwt);
    assert.deepEqual((await respuesta.json() as { candidatos: Array<{ id_chofer: string }> }).candidatos.map((c) => c.id_chofer), ["chofer-disponible"]);
  } finally { await terminar(server); }
});

test("ms-flota excluye choferes ocupados y falla cerrado si viajes no responde", async () => {
  const ctx = datos(); const jwt = ctx.tokens.generar({ idUsuario: "pasajero-1", rol: "PASAJERO" }); ctx.ocupados.marcarActivo("chofer-disponible");
  const { base, server } = await iniciar(ctx.deps);
  try {
    const sinOcupados = await fetch(`${base}/choferes/cercanos?latitud=-27.45&longitud=-58.98`, { headers: { Authorization: `Bearer ${jwt}` } });
    assert.deepEqual((await sinOcupados.json() as { candidatos: unknown[] }).candidatos, []);
    ctx.deps.crearRepositorioViajes = () => ({ async buscarChoferesOcupados() { throw new ErrorFlota("DEPENDENCIA_NO_DISPONIBLE", "falló"); } });
    const caida = await fetch(`${base}/choferes/cercanos?latitud=-27.45&longitud=-58.98`, { headers: { Authorization: `Bearer ${jwt}` } });
    const cuerpo = await caida.json() as { error: { codigo: string; mensaje: string; detalles: object } };
    assert.equal(caida.status, 503);
    assert.equal(cuerpo.error.codigo, "DEPENDENCIA_NO_DISPONIBLE");
    assert.equal(JSON.stringify(cuerpo).includes("falló"), false);
  } finally { await terminar(server); }
});
