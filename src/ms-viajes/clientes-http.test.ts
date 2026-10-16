import { strict as assert } from "node:assert";
import test from "node:test";
import { ClienteServiciosHttp, ErrorDependenciaHttp } from "../compartido/cliente-servicios";
import { ClienteFlotaHttp, ClienteTarifasHttp } from "./clientes-http";

test("ms-viajes recibe una estimación de tarifas y reenvía el JWT", async () => {
  let authorization = "";
  const http = new ClienteServiciosHttp({ obtener: async (_url, opciones) => {
    authorization = new Headers(opciones?.headers).get("Authorization") ?? "";
    return Response.json({ id_estimacion: "estimacion-1", precio_estimado: "8086", moneda: "ARS", multiplicador_demanda: 1.5, factores_precio: { zona_id: "centro" }, creada_en: "2026-10-16T12:00:00Z", vigente_hasta: "2026-10-16T12:03:00Z", origen: { latitud: -27.45, longitud: -58.98 }, destino: { latitud: -27.46, longitud: -58.99 } });
  }, registrarError: () => {} });
  const estimacion = await new ClienteTarifasHttp("http://ms-tarifas:3001", http).obtenerEstimacion("estimacion-1", "jwt-pasajero");
  assert.equal(authorization, "Bearer jwt-pasajero");
  assert.equal(estimacion?.precioEstimado, "8086");
  assert.equal(estimacion?.factoresPrecio.zona_id, "centro");
});

test("ms-viajes consulta candidatos a flota con el JWT del pasajero", async () => {
  let authorization = "";
  const http = new ClienteServiciosHttp({ obtener: async (url, opciones) => {
    authorization = new Headers(opciones?.headers).get("Authorization") ?? "";
    assert.match(String(url), /latitud=-27.45/);
    return Response.json({ candidatos: [{ id_chofer: "chofer-1" }, { id_chofer: "chofer-2" }] });
  }, registrarError: () => {} });
  const ids = await new ClienteFlotaHttp("http://ms-flota:3002", http).buscar({ latitud: -27.45, longitud: -58.98 }, "jwt-pasajero");
  assert.deepEqual(ids, ["chofer-1", "chofer-2"]);
  assert.equal(authorization, "Bearer jwt-pasajero");
});

test("cliente de servicio respeta timeout configurado y reintento único", async () => {
  let llamadas = 0;
  let timeoutMs = 0;
  const timeoutOriginal = AbortSignal.timeout;
  AbortSignal.timeout = ((ms: number) => { timeoutMs = ms; return timeoutOriginal(ms); }) as typeof AbortSignal.timeout;
  const errores: unknown[] = [];
  try {
    const http = new ClienteServiciosHttp({ timeoutMs: 37, reintentos: 1, esperar: async () => {}, registrarError: (evento) => errores.push(evento), obtener: async () => {
      llamadas += 1;
      if (llamadas === 1) return new Response("", { status: 503 });
      return Response.json({ resultado: "ok" });
    } });
    assert.deepEqual(await http.getJson("ms-flota", "candidatos", "http://ms-flota:3002/choferes/cercanos", "token"), { resultado: "ok" });
    assert.equal(llamadas, 2);
    assert.equal(timeoutMs, 37);
    assert.equal(errores.length, 0);
  } finally { AbortSignal.timeout = timeoutOriginal; }
});

test("cliente de servicio falla de forma segura cuando se agota el timeout", async () => {
  let llamadas = 0;
  const eventos: Array<{ servicio: string; operacion: string; resultado: string }> = [];
  const http = new ClienteServiciosHttp({ timeoutMs: 25, reintentos: 1, esperar: async () => {}, registrarError: (evento) => eventos.push(evento), obtener: async () => { llamadas += 1; throw new Error("red caída"); } });
  await assert.rejects(() => http.getJson("ms-viajes", "demanda", "http://ms-viajes/interno", "secreto-no-debe-loguearse"), ErrorDependenciaHttp);
  assert.equal(llamadas, 2);
  assert.deepEqual(eventos, [{ servicio: "ms-viajes", operacion: "demanda", resultado: "timeout_o_red" }]);
  assert.equal(JSON.stringify(eventos).includes("secreto-no-debe-loguearse"), false);
});
