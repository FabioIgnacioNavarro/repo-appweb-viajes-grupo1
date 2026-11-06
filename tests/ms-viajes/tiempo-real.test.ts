import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";
import { PublicarEstadoViaje, type ActorAutenticado, type Viaje } from "../../src/ms-viajes/dominio";
import { AdaptadorWebSocketTiempoReal } from "../../src/ms-viajes/tiempo-real";

async function iniciar(): Promise<{ url: string; http: Server; ws: AdaptadorWebSocketTiempoReal; estadoPersistido: { actual: string } }> {
  const estadoPersistido = { actual: "asignado" };
  const http = createServer((pedido, respuesta) => {
    if (pedido.method === "GET" && pedido.url === "/viajes/viaje-1" && pedido.headers.authorization === "Bearer jwt-pasajero") {
      respuesta.writeHead(200, { "Content-Type": "application/json" });
      respuesta.end(JSON.stringify({ id_viaje: "viaje-1", estado: estadoPersistido.actual }));
      return;
    }
    respuesta.writeHead(404); respuesta.end();
  });
  const actores: Record<string, ActorAutenticado> = {
    "jwt-pasajero": { idUsuario: "pasajero-1", rol: "PASAJERO" },
    "jwt-chofer": { idUsuario: "chofer-1", rol: "CHOFER" }
  };
  const ws = new AdaptadorWebSocketTiempoReal(http, { async validar(token) { const actor = actores[token]; if (!actor) throw new Error("token inválido"); return actor; } });
  await new Promise<void>((resolver) => http.listen(0, "127.0.0.1", resolver));
  const direccion = http.address();
  if (!direccion || typeof direccion === "string") throw new Error("No se pudo iniciar WebSocket de test.");
  return { url: `ws://127.0.0.1:${direccion.port}/tiempo-real`, http, ws, estadoPersistido };
}

test("el handshake WebSocket exige JWT válido", async () => {
  const ctx = await iniciar();
  const conexion = new WebSocket(ctx.url, { headers: { Authorization: "Bearer token-invalido" } });
  try {
    const codigo = await new Promise<number>((resolver, rechazar) => {
      conexion.once("unexpected-response", (_pedido, respuesta) => resolver(respuesta.statusCode ?? 0));
      conexion.once("open", () => rechazar(new Error("Se aceptó un JWT inválido.")));
      conexion.once("error", () => resolver(0));
    });
    assert.equal(codigo, 401);
  } finally {
    await ctx.ws.cerrar();
    ctx.http.close();
  }
});

test("el handshake admite autenticación de navegador sin poner el JWT en la URL ni devolverlo", async () => {
  const ctx = await iniciar();
  const conexion = new WebSocket(ctx.url, ["viajes.v1", "autenticacion-jwt", "jwt-pasajero"]);
  try {
    const mensaje = once(conexion, "message") as Promise<[Buffer, boolean]>;
    await once(conexion, "open");
    let temporizador: ReturnType<typeof setTimeout>;
    const limite = new Promise<never>((_resolver, rechazar) => { temporizador = setTimeout(() => rechazar(new Error("No se confirmó el canal WebSocket.")), 1000); });
    let datos: Buffer;
    try { [datos] = await Promise.race([mensaje, limite]); }
    finally { clearTimeout(temporizador!); }
    assert.equal(JSON.parse(datos.toString()).evento, "CANAL_LISTO");
    assert.equal(conexion.protocol, "viajes.v1");
  } finally {
    conexion.terminate();
    await ctx.ws.cerrar();
    ctx.http.close();
  }
});

test("recibe ofertas y estados, y al reconectar recupera el estado persistido mediante GET", async () => {
  const ctx = await iniciar();
  const conexion = new WebSocket(ctx.url, { headers: { Authorization: "Bearer jwt-chofer" } });
  const pasajero = new WebSocket(ctx.url, { headers: { Authorization: "Bearer jwt-pasajero" } });
  const conexiones = [conexion, pasajero];
  const eventos: Array<{ evento: string; datos: Record<string, unknown> }> = [];
  const eventosPasajero: Array<{ evento: string; datos: Record<string, unknown> }> = [];
  let avisarChofer: (() => void) | undefined;
  let avisarPasajero: (() => void) | undefined;
  conexion.on("message", (datos) => { eventos.push(JSON.parse(datos.toString()) as { evento: string; datos: Record<string, unknown> }); avisarChofer?.(); });
  pasajero.on("message", (datos) => { eventosPasajero.push(JSON.parse(datos.toString()) as { evento: string; datos: Record<string, unknown> }); avisarPasajero?.(); });
  const esperar = async (lista: typeof eventos, evento: string, avisar: (callback: () => void) => void): Promise<void> => {
    const limite = Date.now() + 1000;
    while (!lista.some((mensaje) => mensaje.evento === evento)) {
      if (Date.now() >= limite) throw new Error(`No se recibió ${evento}.`);
      await new Promise<void>((resolver) => { avisar(() => resolver()); setTimeout(resolver, 20); });
    }
  };
  try {
    await Promise.all([once(conexion, "open"), once(pasajero, "open")]);
    await Promise.all([esperar(eventos, "CANAL_LISTO", (callback) => { avisarChofer = callback; }), esperar(eventosPasajero, "CANAL_LISTO", (callback) => { avisarPasajero = callback; })]);
    ctx.ws.publicarAUsuario("chofer-1", "OFERTA_NUEVA", { id_oferta: "oferta-1", id_viaje: "viaje-1" });
    await esperar(eventos, "OFERTA_NUEVA", (callback) => { avisarChofer = callback; });
    assert.deepEqual(eventos.at(-1), { evento: "OFERTA_NUEVA", datos: { id_oferta: "oferta-1", id_viaje: "viaje-1" } });
    assert.equal(eventosPasajero.some((mensaje) => mensaje.evento === "OFERTA_NUEVA"), false);
    const viaje = { id: "viaje-1", pasajeroId: "pasajero-1", choferId: "chofer-1", origen: { latitud: 0, longitud: 0 }, destino: { latitud: 0, longitud: 0 }, estimacionId: "estimacion-1", precioEstimado: "100", moneda: "ARS", multiplicadorDemanda: 1, factoresPrecio: {}, estado: "ASIGNADO", creadoEn: new Date() } as Viaje;
    new PublicarEstadoViaje(ctx.ws).ejecutar(viaje);
    await Promise.all([esperar(eventos, "ESTADO_VIAJE_ACTUALIZADO", (callback) => { avisarChofer = callback; }), esperar(eventosPasajero, "ESTADO_VIAJE_ACTUALIZADO", (callback) => { avisarPasajero = callback; })]);
    assert.equal(eventos.at(-1)?.datos.estado, "asignado");

    conexion.terminate();
    ctx.estadoPersistido.actual = "en_curso";
    const recuperado = await fetch(ctx.url.replace("ws://", "http://").replace("/tiempo-real", "/viajes/viaje-1"), { headers: { Authorization: "Bearer jwt-pasajero" } });
    assert.deepEqual(await recuperado.json(), { id_viaje: "viaje-1", estado: "en_curso" });
    const reconexion = new WebSocket(ctx.url, { headers: { Authorization: "Bearer jwt-chofer" } });
    conexiones.push(reconexion);
    const eventosReconexion: string[] = [];
    reconexion.on("message", (datos) => eventosReconexion.push((JSON.parse(datos.toString()) as { evento: string }).evento));
    await once(reconexion, "open");
    const limite = Date.now() + 1000;
    while (!eventosReconexion.includes("CANAL_LISTO") && Date.now() < limite) await new Promise((resolver) => setTimeout(resolver, 10));
    assert.ok(eventosReconexion.includes("CANAL_LISTO"));
    reconexion.terminate();
  } finally {
    for (const actual of conexiones) actual.terminate();
    await ctx.ws.cerrar();
    ctx.http.close();
  }
});
