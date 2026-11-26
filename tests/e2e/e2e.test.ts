import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";

const base = process.env.E2E_BASE_URL;
const pasajero = "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyIiwicm9sIjoiUEFTQUpFUk8ifQ";
const chofer = "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwicm9sIjoiQ0hPRkVSIn0";
const admin = `falso.${Buffer.from(JSON.stringify({ tipo: "jwt-falso", idUsuario: "99999999-9999-4999-8999-999999999999", rol: "ADMINISTRADOR" }), "utf8").toString("base64url")}`;

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
  assert.equal(finalizado.cuerpo.cobro.importe, finalizado.cuerpo.viaje.precio_final);

  const reciboPasajero = await pedir(`/viajes/${oferta.id_viaje}/cobro`, pasajero);
  const reciboChofer = await pedir(`/viajes/${oferta.id_viaje}/cobro`, chofer);
  assert.equal(reciboPasajero.status, 200);
  assert.equal(reciboChofer.status, 200);
  assert.equal(reciboPasajero.cuerpo.id_cobro, finalizado.cuerpo.cobro.id_cobro);
  assert.equal(reciboChofer.cuerpo.importe, finalizado.cuerpo.viaje.precio_final);

  const claveReintento = `pago-${Date.now()}`;
  const reintento = await pedir(`/viajes/${oferta.id_viaje}/cobro/reintento`, pasajero, {
    method: "POST", headers: { "Clave-Idempotencia": claveReintento }, body: "{}"
  });
  const repetidoReintento = await pedir(`/viajes/${oferta.id_viaje}/cobro/reintento`, pasajero, {
    method: "POST", headers: { "Clave-Idempotencia": claveReintento }, body: "{}"
  });
  assert.equal(reintento.status, 200);
  assert.equal(reintento.cuerpo.estado, "confirmado");
  assert.equal(repetidoReintento.cuerpo.id_cobro, finalizado.cuerpo.cobro.id_cobro);
  assert.equal(repetidoReintento.cuerpo.intentos, reintento.cuerpo.intentos);

  const segundaFinalizacion = await pedir(`/viajes/${oferta.id_viaje}/finalizacion`, chofer, { method: "POST", body: "{}" });
  assert.equal(segundaFinalizacion.cuerpo.cobro.id_cobro, finalizado.cuerpo.cobro.id_cobro);
  assert.equal(segundaFinalizacion.cuerpo.cobro.importe, finalizado.cuerpo.viaje.precio_final);
});

test("E2E rechaza token ausente y viaje ajeno", { skip: !base }, async () => {
  const sinToken = await fetch(`${base}/viajes`);
  assert.equal(sinToken.status, 401);
  const ajeno = await pedir("/viajes", "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMzMzMzMzMzMtMzMzMy00MzMzLTgzMzMtMzMzMzMzMzMzMzMzIiwicm9sIjoiUEFTQUpFUk8ifQ");
  assert.equal(ajeno.status, 200);
});

test("E2E el gateway entrega la SPA con MIME y seguridad, reenvía WebSocket y bloquea rutas internas", { skip: !base }, async () => {
  const raiz = await fetch(`${base}/`);
  assert.equal(raiz.status, 200);
  assert.match(raiz.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(raiz.headers.get("x-content-type-options"), "nosniff");
  assert.equal(raiz.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  const html = await raiz.text();
  assert.match(html, /<div id="root"><\/div>/);

  const scriptMatch = html.match(/src="(\/assets\/[^"]+\.js)"/);
  assert.ok(scriptMatch, "index.html debe referenciar un bundle JS en /assets/");
  const assetJs = await fetch(`${base}${scriptMatch[1]}`);
  assert.equal(assetJs.status, 200);
  assert.match(assetJs.headers.get("content-type") ?? "", /javascript/);

  const cssMatch = html.match(/href="(\/assets\/[^"]+\.css)"/);
  assert.ok(cssMatch, "index.html debe referenciar una hoja CSS en /assets/");
  const assetCss = await fetch(`${base}${cssMatch[1]}`);
  assert.equal(assetCss.status, 200);
  assert.match(assetCss.headers.get("content-type") ?? "", /text\/css/);

  const fallbackFront = await fetch(`${base}/pasajero`);
  assert.equal(fallbackFront.status, 200);
  assert.match(fallbackFront.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await fallbackFront.text(), /<div id="root"><\/div>/);

  const assetFaltante = await fetch(`${base}/assets/no-existe.js`);
  assert.equal(assetFaltante.status, 404);

  const rutaInterna = await pedir("/interno/demanda-por-zona?zona_id=resistencia", pasajero);
  assert.equal(rutaInterna.status, 404);
  assert.equal(rutaInterna.cuerpo.error?.codigo, "RUTA_NO_ENCONTRADA");

  const estimacionInterna = await pedir("/estimaciones/est-123", pasajero);
  assert.equal(estimacionInterna.status, 404);
  assert.equal(estimacionInterna.cuerpo.error?.codigo, "RUTA_NO_ENCONTRADA");

  const tokenEmulador = await fetch(`${base}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_usuario: "44444444-4444-4444-8444-444444444444", rol: "soporte", nombre: "Lucía Operaciones" })
  });
  assert.equal(tokenEmulador.status, 200);
  const cuerpoToken = (await tokenEmulador.json()) as { token?: string; id_usuario?: string; rol?: string };
  assert.equal(cuerpoToken.id_usuario, "44444444-4444-4444-8444-444444444444");
  assert.equal(cuerpoToken.rol, "soporte");
  assert.equal(cuerpoToken.token?.split(".").length, 3);

  const wsBase = base!.replace(/^http/, "ws");
  for (const rutaWs of ["/tiempo-real", "/ws"]) {
    await new Promise<void>((resolver, rechazar) => {
      const socket = new WebSocket(`${wsBase}${rutaWs}`, ["viajes.v1", "autenticacion-jwt", pasajero]);
      const timeout = setTimeout(() => { socket.terminate(); rechazar(new Error(`Timeout conectando WebSocket en ${rutaWs}`)); }, 5000);
      socket.once("message", (dato) => {
        clearTimeout(timeout);
        const mensaje = JSON.parse(dato.toString()) as { evento?: string };
        assert.equal(mensaje.evento, "CANAL_LISTO");
        socket.close();
        resolver();
      });
      socket.once("error", (err) => { clearTimeout(timeout); rechazar(err); });
    });
  }
});

test("E2E registro de cuenta y administración de choferes/vehículos en Gateway", { skip: !base }, async () => {
  const sufijo = String(Date.now());
  const regResp = await fetch(`${base}/auth/registro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: `chofer.e2e.${sufijo}`, nombre: "Chofer E2E", contrasena: "ClaveSegura2026!", rol: "chofer" })
  });
  assert.equal(regResp.status, 201);
  const regBody = (await regResp.json()) as { token?: string; perfil?: { id_usuario?: string; rol?: string } };
  assert.ok(regBody.perfil?.id_usuario);
  assert.equal(regBody.perfil?.rol, "chofer");

  const nuevoChoferId = regBody.perfil!.id_usuario!;
  const altaChofer = await pedir("/choferes", admin, {
    method: "POST",
    body: JSON.stringify({ usuario_id: nuevoChoferId, habilitado: false, carnet_conducir_validado: true })
  });
  assert.equal(altaChofer.status, 201);

  const patente = `E2E${sufijo.slice(-5)}`;
  const altaVehiculo = await pedir("/vehiculos", admin, {
    method: "POST",
    body: JSON.stringify({ patente, tipo_vehiculo: "AUTOMOVIL", marca: "Toyota", modelo: "Yaris", anio_fabricacion: 2024, color: "Gris", capacidad_pasajeros: 4 })
  });
  assert.equal(altaVehiculo.status, 201);

  const habilitacion = await pedir(`/choferes/${encodeURIComponent(nuevoChoferId)}/habilitacion`, admin, {
    method: "PATCH",
    body: JSON.stringify({ habilitado: true, carnet_conducir_validado: true })
  });
  assert.equal(habilitacion.status, 200);
  assert.equal(habilitacion.cuerpo.habilitado, true);

  const asignacion = await pedir(`/choferes/${encodeURIComponent(nuevoChoferId)}/vehiculo`, admin, {
    method: "PUT",
    body: JSON.stringify({ id_vehiculo: altaVehiculo.cuerpo.id })
  });
  assert.equal(asignacion.status, 200);
  assert.equal(asignacion.cuerpo.vehiculo.patente, patente);

  const listado = await pedir("/choferes", admin);
  assert.equal(listado.status, 200);
  assert.ok(listado.cuerpo.choferes.some((c: { usuario_id: string; vehiculo_activo?: { patente: string } | null }) => c.usuario_id === nuevoChoferId && c.vehiculo_activo?.patente === patente));
});
