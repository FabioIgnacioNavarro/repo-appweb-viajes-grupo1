import assert from "node:assert/strict";
import { test } from "node:test";

const base = process.env.E2E_BASE_URL;
const pasajero = "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyIiwicm9sIjoiUEFTQUpFUk8ifQ";
const chofer = "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwicm9sIjoiQ0hPRkVSIn0";

async function pedir(ruta: string, token: string, opciones: RequestInit = {}): Promise<{ status: number; cuerpo: any }> {
  const respuesta = await fetch(`${base}${ruta}`, { ...opciones, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opciones.headers ?? {}) } });
  const texto = await respuesta.text();
  let cuerpo: any;
  try { cuerpo = JSON.parse(texto); } catch { throw new Error(`Respuesta no JSON en ${ruta}: ${respuesta.status} ${texto.slice(0, 120)}`); }
  return { status: respuesta.status, cuerpo };
}

test("E2E flujo feliz: estimar, confirmar, ofertar, asignar y cobrar", { skip: !base }, async () => {
  const ubicacion = await pedir("/choferes/yo/ubicacion", chofer, { method: "POST", body: JSON.stringify({ latitud: -27.45, longitud: -58.98, actualizado_at: new Date().toISOString() }) });
  assert.equal(ubicacion.status, 200);
  const disponibilidad = await pedir("/choferes/yo/disponibilidad", chofer, { method: "PATCH", body: JSON.stringify({ disponibilidad: true }) });
  assert.equal(disponibilidad.status, 200);
  const candidatos = await pedir("/choferes/cercanos?latitud=-27.45&longitud=-58.98&radio_metros=5000", pasajero);
  assert.equal(candidatos.status, 200);
  assert.ok(candidatos.cuerpo.candidatos.some((c: any) => c.id_chofer === "11111111-1111-4111-8111-111111111111"));

  const estimacion = await pedir("/viajes/estimacion", pasajero, { method: "POST", body: JSON.stringify({ origen: { latitud: -27.45, longitud: -58.98 }, destino: { latitud: -27.46, longitud: -58.97 } }) });
  assert.equal(estimacion.status, 201);
  const clave = `e2e-${Date.now()}`;
  const confirmado = await pedir("/viajes", pasajero, { method: "POST", headers: { "Clave-Idempotencia": clave }, body: JSON.stringify({ id_estimacion: estimacion.cuerpo.id_estimacion }) });
  assert.equal(confirmado.status, 201);
  const repetido = await pedir("/viajes", pasajero, { method: "POST", headers: { "Clave-Idempotencia": clave }, body: JSON.stringify({ id_estimacion: estimacion.cuerpo.id_estimacion }) });
  assert.equal(repetido.status, 201);
  assert.equal(repetido.cuerpo.id_viaje, confirmado.cuerpo.id_viaje);

  const ofertas = await pedir("/choferes/yo/ofertas", chofer);
  assert.equal(ofertas.status, 200);
  assert.ok(ofertas.cuerpo.ofertas.length >= 1);
  const oferta = ofertas.cuerpo.ofertas.find((o: any) => o.id_viaje === confirmado.cuerpo.id_viaje);
  assert.ok(oferta);
  const aceptacion = await pedir(`/choferes/yo/ofertas/${oferta.id_oferta}/aceptacion`, chofer, { method: "POST", body: "{}" });
  assert.equal(aceptacion.status, 200);
  assert.equal(aceptacion.cuerpo.estado, "asignado");
  assert.equal((await pedir(`/viajes/${oferta.id_viaje}/llegada`, chofer, { method: "POST", body: "{}" })).status, 200);
  assert.equal((await pedir(`/viajes/${oferta.id_viaje}/inicio`, chofer, { method: "POST", body: "{}" })).status, 200);
  const finalizado = await pedir(`/viajes/${oferta.id_viaje}/finalizacion`, chofer, { method: "POST", body: "{}" });
  assert.equal(finalizado.status, 200);
  assert.equal(finalizado.cuerpo.viaje.estado, "finalizado");
  assert.equal(finalizado.cuerpo.cobro.estado, "confirmado");
});

test("E2E rechaza token ausente y viaje ajeno", { skip: !base }, async () => {
  const sinToken = await fetch(`${base}/viajes`);
  assert.equal(sinToken.status, 401);
  const ajeno = await pedir("/viajes", "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMzMzMzMzMzMtMzMzMy00MzMzLTgzMzMtMzMzMzMzMzMzMzMzIiwicm9sIjoiUEFTQUpFUk8ifQ");
  assert.equal(ajeno.status, 200);
});
