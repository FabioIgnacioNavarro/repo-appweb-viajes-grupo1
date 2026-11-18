import express from "express";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  AceptarOferta, AsignadorAtomicoMemoria, AvanzarViaje, CancelarViaje, ConsultarOfertasChofer, ConfirmarViaje,
  ConsultarChoferesOcupados, ConsultarDemandaPorZona, ConsultarViaje, CrearOferta, FinalizarViaje, GeneradorIdMemoria, PublicarEstadoViaje, PublicarUbicacionChoferEnViaje, RechazarOferta,
  RepositorioCobrosMemoria, RepositorioIdempotenciaMemoria, RepositorioOfertasMemoria,
  RepositorioViajesMemoria, ListarViajesOperador, ConsultarAuditoriaTarifa, type EstimacionVigente
} from "../../src/ms-viajes/dominio";
import { crearRouterViajes, ValidadorTokenFalso, type DependenciasViajes } from "../../src/ms-viajes/http";
import { ErrorDependenciaHttp } from "../../src/compartido/cliente-servicios";

const ahoraPrueba = new Date();
const estimacion: EstimacionVigente = {
  id: "estimacion-http-1", origen: { latitud: -27.45, longitud: -58.98 }, destino: { latitud: -27.46, longitud: -58.99 },
  precioEstimado: "8086", moneda: "ARS", multiplicadorDemanda: 1.5,
  factoresPrecio: { zona_id: "resistencia", solicitudes_activas: 24, choferes_disponibles: 8 },
  versionRegla: 1,
  creadaEn: ahoraPrueba, vigenteHasta: new Date(ahoraPrueba.getTime() + 180_000)
};

async function servidorDePrueba(): Promise<{ base: string; servidor: Server; deps: DependenciasViajes }> {
  const viajes = new RepositorioViajesMemoria();
  const ofertas = new RepositorioOfertasMemoria();
  const cobros = new RepositorioCobrosMemoria();
  const ids = new GeneradorIdMemoria();
  const estimaciones = new Map([[estimacion.id, estimacion]]);
  const idempotencia = new RepositorioIdempotenciaMemoria();
  const asignador = new AsignadorAtomicoMemoria();
  const deps: DependenciasViajes = {
    viajes, ofertas,
    listarViajesOperador: new ListarViajesOperador(viajes),
    auditoriaTarifa: new ConsultarAuditoriaTarifa(viajes),
    confirmar: new ConfirmarViaje(viajes, idempotencia, ids),
    aceptar: new AceptarOferta(ofertas, viajes, asignador),
    rechazar: new RechazarOferta(ofertas),
    cancelar: new CancelarViaje(viajes, asignador),
    avanzar: new AvanzarViaje(viajes),
    finalizar: new FinalizarViaje(viajes, cobros, asignador, ids),
    consultar: new ConsultarViaje(viajes),
    validadorToken: new ValidadorTokenFalso({
      pasajero: { idUsuario: "pasajero-1", rol: "PASAJERO" },
      pasajeroDos: { idUsuario: "pasajero-2", rol: "PASAJERO" },
      chofer: { idUsuario: "chofer-1", rol: "CHOFER" },
      otroChofer: { idUsuario: "chofer-2", rol: "CHOFER" },
      soporte: { idUsuario: "soporte-1", rol: "SOPORTE" },
      administrador: { idUsuario: "admin-1", rol: "ADMINISTRADOR" }
    }),
    obtenerEstimacion: async (actor, id) => actor.idUsuario === "pasajero-1" ? estimaciones.get(id) : undefined,
    consultarDemanda: new ConsultarDemandaPorZona(viajes),
    consultarOcupacion: new ConsultarChoferesOcupados(viajes)
  };
  const app = express();
  app.use(crearRouterViajes(deps));
  const servidor = createServer(app);
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const direccion = servidor.address();
  if (!direccion || typeof direccion === "string") throw new Error("No se pudo abrir el servidor de test.");
  return { base: `http://127.0.0.1:${direccion.port}`, servidor, deps };
}

async function cerrar(servidor: Server): Promise<void> { await new Promise<void>((resolver, rechazar) => servidor.close((error) => error ? rechazar(error) : resolver())); }
async function pedido(base: string, ruta: string, token = "pasajero", opciones: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${ruta}`, { ...opciones, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opciones.headers ?? {}) } });
}

test("la API crea un viaje autenticado y la confirmacion HTTP es idempotente", async () => {
  const contexto = await servidorDePrueba();
  try {
    const opciones: RequestInit = { method: "POST", body: JSON.stringify({ id_estimacion: estimacion.id }), headers: { "Clave-Idempotencia": "http-1" } };
    const primero = await pedido(contexto.base, "/viajes", "pasajero", opciones);
    const cuerpo = await primero.json() as { id_viaje: string; precio_estimado: string };
    const segundo = await pedido(contexto.base, "/viajes", "pasajero", opciones);
    const reintento = await segundo.json() as { id_viaje: string };
    assert.equal(primero.status, 201);
    assert.equal(cuerpo.precio_estimado, "8086");
    assert.equal(reintento.id_viaje, cuerpo.id_viaje);
    assert.equal((await contexto.deps.viajes.listar()).length, 1);
  } finally { await cerrar(contexto.servidor); }
});

test("soporte obtiene el listado global filtrado y paginado, pero un pasajero no puede filtrar", async () => {
  const contexto = await servidorDePrueba();
  try {
    const instantesCreacion: string[] = [];
    for (const clave of ["listado-1", "listado-2", "listado-3"]) {
      const creada = await pedido(contexto.base, "/viajes", "pasajero", {
        method: "POST", body: JSON.stringify({ id_estimacion: estimacion.id }), headers: { "Clave-Idempotencia": clave }
      });
      assert.equal(creada.status, 201);
      instantesCreacion.push((await creada.json() as { creado_en: string }).creado_en);
    }
    const respuesta = await pedido(contexto.base, "/viajes?estado=solicitado&pagina=2&limite=2", "soporte");
    const cuerpo = await respuesta.json() as { viajes: Array<{ estado: string }>; pagina: number; limite: number; total: number };
    assert.equal(respuesta.status, 200);
    assert.equal(cuerpo.viajes.length, 1);
    assert.equal(cuerpo.viajes[0].estado, "solicitado");
    assert.deepEqual({ pagina: cuerpo.pagina, limite: cuerpo.limite, total: cuerpo.total }, { pagina: 2, limite: 2, total: 3 });

    const primeraFecha = new Date([...instantesCreacion].sort()[0]);
    const desdeInclusivo = encodeURIComponent(primeraFecha.toISOString());
    const hastaInclusivo = encodeURIComponent(new Date(primeraFecha.getTime() + 86_400_000).toISOString());
    const porFecha = await pedido(contexto.base, `/viajes?desde=${desdeInclusivo}&hasta=${hastaInclusivo}`, "soporte");
    const filtrados = await porFecha.json() as { total: number };
    assert.equal(porFecha.status, 200);
    assert.equal(filtrados.total, 3);
    const hastaExclusivo = await pedido(contexto.base,
      `/viajes?desde=${encodeURIComponent(new Date(primeraFecha.getTime() - 86_400_000).toISOString())}&hasta=${desdeInclusivo}`, "soporte");
    assert.equal((await hastaExclusivo.json() as { total: number }).total, 0);

    const denegada = await pedido(contexto.base, "/viajes?estado=solicitado", "pasajero");
    assert.equal(denegada.status, 403);
    assert.equal((await denegada.json() as { error: { codigo: string } }).error.codigo, "ROL_NO_AUTORIZADO");
    const invalida = await pedido(contexto.base, "/viajes?estado=inventado", "administrador");
    assert.equal(invalida.status, 400);
    assert.equal((await invalida.json() as { error: { codigo: string } }).error.codigo, "ENTRADA_INVALIDA");
    const paginaDesbordada = await pedido(contexto.base, "/viajes?pagina=9007199254740991&limite=100", "soporte");
    assert.equal(paginaDesbordada.status, 400);
  } finally { await cerrar(contexto.servidor); }
});

test("auditoria devuelve el snapshot confirmado y solo para soporte o administración", async () => {
  const contexto = await servidorDePrueba();
  try {
    const creada = await pedido(contexto.base, "/viajes", "pasajero", {
      method: "POST", body: JSON.stringify({ id_estimacion: estimacion.id }), headers: { "Clave-Idempotencia": "auditoria-http" }
    });
    const viaje = await creada.json() as { id_viaje: string };
    const respuesta = await pedido(contexto.base, `/viajes/${viaje.id_viaje}/auditoria-tarifa`, "administrador");
    const cuerpo = await respuesta.json() as { precio_confirmado: string; moneda: string; multiplicador_demanda: number; version_regla: number; factores_precio: Record<string, unknown> };
    assert.equal(respuesta.status, 200);
    assert.equal(cuerpo.precio_confirmado, "8086");
    assert.equal(cuerpo.moneda, "ARS");
    assert.equal(cuerpo.multiplicador_demanda, 1.5);
    assert.equal(cuerpo.version_regla, 1);
    assert.equal(cuerpo.factores_precio.version_regla, 1);

    const denegada = await pedido(contexto.base, `/viajes/${viaje.id_viaje}/auditoria-tarifa`, "pasajero");
    assert.equal(denegada.status, 403);
    const inexistente = await pedido(contexto.base, "/viajes/no-existe/auditoria-tarifa", "soporte");
    assert.equal(inexistente.status, 404);
  } finally { await cerrar(contexto.servidor); }
});

test("la API protege la consulta de un viaje ajeno y un token ausente", async () => {
  const contexto = await servidorDePrueba();
  try {
    const creado = await pedido(contexto.base, "/viajes", "pasajero", { method: "POST", body: JSON.stringify({ id_estimacion: estimacion.id }), headers: { "Clave-Idempotencia": "http-2" } });
    const viaje = await creado.json() as { id_viaje: string };
    const ajeno = await pedido(contexto.base, `/viajes/${viaje.id_viaje}`, "pasajeroDos");
    const sinToken = await fetch(`${contexto.base}/viajes/${viaje.id_viaje}`);
    assert.equal(ajeno.status, 403);
    assert.equal((await ajeno.json() as { error: { codigo: string } }).error.codigo, "VIAJE_NO_AUTORIZADO");
    assert.equal(sinToken.status, 401);
    assert.equal((await sinToken.json() as { error: { codigo: string } }).error.codigo, "TOKEN_REQUERIDO");
  } finally { await cerrar(contexto.servidor); }
});

test("la API acepta una oferta solo por su chofer y traduce una transicion invalida", async () => {
  const contexto = await servidorDePrueba();
  try {
    const creado = await pedido(contexto.base, "/viajes", "pasajero", { method: "POST", body: JSON.stringify({ id_estimacion: estimacion.id }), headers: { "Clave-Idempotencia": "http-3" } });
    const viaje = await creado.json() as { id_viaje: string };
    const ids = new GeneradorIdMemoria();
    const creada = await new CrearOferta(contexto.deps.ofertas, contexto.deps.viajes, ids).ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje.id_viaje, "chofer-1", new Date(Date.now() + 60_000));
    const ajeno = await pedido(contexto.base, `/choferes/yo/ofertas/${creada.id}/aceptacion`, "otroChofer", { method: "POST", body: "{}" });
    assert.equal(ajeno.status, 403);
    const aceptada = await pedido(contexto.base, `/choferes/yo/ofertas/${creada.id}/aceptacion`, "chofer", { method: "POST", body: "{}" });
    assert.equal(aceptada.status, 200);
    const llegada = await pedido(contexto.base, `/viajes/${viaje.id_viaje}/llegada`, "chofer", { method: "POST", body: "{}" });
    assert.equal(llegada.status, 200);
    const llegadaRepetida = await pedido(contexto.base, `/viajes/${viaje.id_viaje}/llegada`, "chofer", { method: "POST", body: "{}" });
    assert.equal(llegadaRepetida.status, 409);
    assert.equal((await llegadaRepetida.json() as { error: { codigo: string } }).error.codigo, "TRANSICION_ESTADO_INVALIDA");
  } finally { await cerrar(contexto.servidor); }
});

test("la API devuelve el contrato 503 cuando una dependencia de matching cae", async () => {
  const contexto = await servidorDePrueba();
  contexto.deps.confirmarConOfertas = async () => { throw new ErrorDependenciaHttp("ms-flota", "buscar_candidatos"); };
  try {
    const respuesta = await pedido(contexto.base, "/viajes", "pasajero", { method: "POST", body: JSON.stringify({ id_estimacion: estimacion.id }), headers: { "Clave-Idempotencia": "http-dependencia" } });
    const cuerpo = await respuesta.json() as { error: { codigo: string; mensaje: string; detalles: object } };
    assert.equal(respuesta.status, 503);
    assert.deepEqual(cuerpo.error, { codigo: "DEPENDENCIA_NO_DISPONIBLE", mensaje: "No se pudo completar la operación por una dependencia temporalmente no disponible.", detalles: {} });
    assert.equal(JSON.stringify(cuerpo).includes("ms-flota"), false);
  } finally { await cerrar(contexto.servidor); }
});

test("las rutas internas exponen demanda por zona y solo los choferes ocupados solicitados", async () => {
  const contexto = await servidorDePrueba();
  try {
    const creado = await pedido(contexto.base, "/viajes", "pasajero", { method: "POST", body: JSON.stringify({ id_estimacion: estimacion.id }), headers: { "Clave-Idempotencia": "http-interno" } });
    const viaje = await creado.json() as { id_viaje: string };
    const demanda = await pedido(contexto.base, "/interno/demanda-por-zona?zona_id=resistencia", "pasajero");
    assert.deepEqual(await demanda.json(), { zona_id: "resistencia", solicitudes_activas: 1 });
    const oferta = await new CrearOferta(contexto.deps.ofertas, contexto.deps.viajes, new GeneradorIdMemoria()).ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje.id_viaje, "chofer-1", new Date(Date.now() + 60_000));
    await pedido(contexto.base, `/choferes/yo/ofertas/${oferta.id}/aceptacion`, "chofer", { method: "POST", body: "{}" });
    const ocupados = await pedido(contexto.base, "/interno/choferes/ocupados?ids_choferes=chofer-1,otro-chofer", "pasajero");
    assert.deepEqual(await ocupados.json(), { ids_choferes_ocupados: ["chofer-1"] });
  } finally { await cerrar(contexto.servidor); }
});

test("la ubicación interna solo se publica de forma aproximada al pasajero del chofer activo", async () => {
  const contexto = await servidorDePrueba();
  const publicaciones: Array<{ usuario: string; evento: string; datos: Record<string, unknown> }> = [];
  const eventos = { publicarAUsuario(usuario: string, evento: string, datos: Record<string, unknown>) { publicaciones.push({ usuario, evento, datos }); } };
  contexto.deps.eventosTiempoReal = eventos;
  contexto.deps.publicarEstado = new PublicarEstadoViaje(eventos);
  contexto.deps.publicarUbicacion = new PublicarUbicacionChoferEnViaje(contexto.deps.viajes, eventos);
  try {
    const creado = await pedido(contexto.base, "/viajes", "pasajero", { method: "POST", body: JSON.stringify({ id_estimacion: estimacion.id }), headers: { "Clave-Idempotencia": "http-ubicacion" } });
    const viaje = await creado.json() as { id_viaje: string };
    const oferta = await new CrearOferta(contexto.deps.ofertas, contexto.deps.viajes, new GeneradorIdMemoria()).ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje.id_viaje, "chofer-1", new Date(Date.now() + 60_000));
    await pedido(contexto.base, `/choferes/yo/ofertas/${oferta.id}/aceptacion`, "chofer", { method: "POST", body: "{}" });
    await pedido(contexto.base, `/viajes/${viaje.id_viaje}/llegada`, "chofer", { method: "POST", body: "{}" });

    const denegada = await pedido(contexto.base, "/interno/viajes/ubicacion-chofer", "otroChofer", { method: "POST", body: JSON.stringify({ latitud: -27.4519, longitud: -58.9864 }) });
    assert.equal(denegada.status, 204);
    const pasajero = await pedido(contexto.base, "/interno/viajes/ubicacion-chofer", "pasajero", { method: "POST", body: JSON.stringify({ latitud: -27.4519, longitud: -58.9864 }) });
    assert.equal(pasajero.status, 403);
    const aceptada = await pedido(contexto.base, "/interno/viajes/ubicacion-chofer", "chofer", { method: "POST", body: JSON.stringify({ latitud: -27.4519, longitud: -58.9864, actualizado_at: "2026-11-02T17:00:00.000Z" }) });
    assert.equal(aceptada.status, 202);
    const ubicacion = publicaciones.find((p) => p.evento === "UBICACION_CHOFER_ACTUALIZADA");
    assert.equal(ubicacion?.usuario, "pasajero-1");
    assert.equal(ubicacion?.datos.latitud, -27.452);
    assert.equal(ubicacion?.datos.longitud, -58.986);
  } finally { await cerrar(contexto.servidor); }
});

test("al asignar o cancelar un viaje, las ofertas restantes reciben su notificación y estado final", async () => {
  const contexto = await servidorDePrueba();
  const publicaciones: Array<{ usuario: string; evento: string; datos: Record<string, unknown> }> = [];
  const eventos = { publicarAUsuario(usuario: string, evento: string, datos: Record<string, unknown>) { publicaciones.push({ usuario, evento, datos }); } };
  contexto.deps.aceptar = new AceptarOferta(contexto.deps.ofertas, contexto.deps.viajes, new AsignadorAtomicoMemoria(), eventos);
  contexto.deps.cancelar = new CancelarViaje(contexto.deps.viajes, new AsignadorAtomicoMemoria(), contexto.deps.ofertas, eventos);
  try {
    const creado = await pedido(contexto.base, "/viajes", "pasajero", { method: "POST", body: JSON.stringify({ id_estimacion: estimacion.id }), headers: { "Clave-Idempotencia": "http-ofertas-restantes" } });
    const viaje = await creado.json() as { id_viaje: string };
    const ids = new GeneradorIdMemoria();
    const ofertaAceptada = await new CrearOferta(contexto.deps.ofertas, contexto.deps.viajes, ids).ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje.id_viaje, "chofer-1", new Date(Date.now() + 60_000));
    const ofertaRestante = await new CrearOferta(contexto.deps.ofertas, contexto.deps.viajes, ids).ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje.id_viaje, "chofer-2", new Date(Date.now() + 60_000));
    const respuesta = await pedido(contexto.base, `/choferes/yo/ofertas/${ofertaAceptada.id}/aceptacion`, "chofer", { method: "POST", body: "{}" });
    assert.equal(respuesta.status, 200);
    assert.equal((await contexto.deps.ofertas.obtener(ofertaRestante.id))?.estado, "NO_SELECCIONADA");
    assert.ok(publicaciones.some((p) => p.usuario === "chofer-2" && p.evento === "OFERTA_CANCELADA" && p.datos.motivo === "viaje_asignado"));

    const segundo = await pedido(contexto.base, "/viajes", "pasajero", { method: "POST", body: JSON.stringify({ id_estimacion: estimacion.id }), headers: { "Clave-Idempotencia": "http-viaje-cancelado" } });
    const viajeCancelado = await segundo.json() as { id_viaje: string };
    const ofertaCancelada = await new CrearOferta(contexto.deps.ofertas, contexto.deps.viajes, ids).ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viajeCancelado.id_viaje, "chofer-2", new Date(Date.now() + 60_000));
    const cancelacion = await pedido(contexto.base, `/viajes/${viajeCancelado.id_viaje}/cancelacion`, "pasajero", { method: "POST", body: JSON.stringify({ motivo: "prueba" }) });
    assert.equal(cancelacion.status, 200);
    assert.equal((await contexto.deps.ofertas.obtener(ofertaCancelada.id))?.estado, "CANCELADA");
    assert.ok(publicaciones.some((p) => p.usuario === "chofer-2" && p.evento === "OFERTA_CANCELADA" && p.datos.motivo === "viaje_cancelado"));
  } finally { await cerrar(contexto.servidor); }
});

test("al recuperar las ofertas, materializa y notifica los vencimientos observados", async () => {
  const contexto = await servidorDePrueba();
  const publicaciones: Array<{ usuario: string; evento: string; datos: Record<string, unknown> }> = [];
  const eventos = { publicarAUsuario(usuario: string, evento: string, datos: Record<string, unknown>) { publicaciones.push({ usuario, evento, datos }); } };
  contexto.deps.consultarOfertas = new ConsultarOfertasChofer(contexto.deps.ofertas, eventos);
  const enviada = new Date(Date.now() - 120_000);
  const expirada = await contexto.deps.ofertas.guardar({ id: "oferta-vencida", viajeId: "viaje-vencido", choferId: "chofer-1", estado: "PENDIENTE", enviadaEm: enviada, expiraEm: new Date(enviada.getTime() + 60_000) });
  try {
    const respuesta = await pedido(contexto.base, "/choferes/yo/ofertas", "chofer");
    const cuerpo = await respuesta.json() as { ofertas: Array<{ id_oferta: string; estado: string }> };
    assert.equal(respuesta.status, 200);
    assert.equal(cuerpo.ofertas.find((oferta) => oferta.id_oferta === expirada.id)?.estado, "vencida");
    assert.ok(publicaciones.some((p) => p.usuario === "chofer-1" && p.evento === "OFERTA_VENCIDA"));
  } finally { await cerrar(contexto.servidor); }
});
