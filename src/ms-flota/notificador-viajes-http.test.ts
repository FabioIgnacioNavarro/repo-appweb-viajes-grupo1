import { strict as assert } from "node:assert";
import test from "node:test";
import { NotificadorUbicacionViajesHttp } from "./notificador-viajes-http";

test("el adaptador interno reenvía ubicación ya guardada con JWT y timeout acotado", async () => {
  let urlRecibida = "";
  let opcionesRecibidas: RequestInit | undefined;
  const adaptador = new NotificadorUbicacionViajesHttp("http://ms-viajes:3000", 250, async (url, opciones) => {
    urlRecibida = String(url);
    opcionesRecibidas = opciones;
    return new Response(null, { status: 202 });
  });
  await adaptador.publicar({ idUsuario: "chofer-1", rol: "CHOFER" }, { latitud: -27.45, longitud: -58.98, actualizadoAt: new Date("2026-11-02T17:00:00.000Z") }, "jwt-original");
  assert.equal(urlRecibida, "http://ms-viajes:3000/interno/viajes/ubicacion-chofer");
  assert.equal(opcionesRecibidas?.method, "POST");
  assert.equal((opcionesRecibidas?.headers as Record<string, string>).Authorization, "Bearer jwt-original");
  assert.deepEqual(JSON.parse(String(opcionesRecibidas?.body)), { latitud: -27.45, longitud: -58.98, actualizado_at: "2026-11-02T17:00:00.000Z" });
  assert.ok(opcionesRecibidas?.signal instanceof AbortSignal);
});

test("el adaptador de Flota no considera aceptada una publicación interna rechazada", async () => {
  const adaptador = new NotificadorUbicacionViajesHttp("http://ms-viajes:3000", 100, async () => new Response(null, { status: 403 }));
  await assert.rejects(() => adaptador.publicar({ idUsuario: "chofer-1", rol: "CHOFER" }, { latitud: 0, longitud: 0, actualizadoAt: new Date() }, "jwt"));
});
