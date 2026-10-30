import express from "express";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  AceptarOferta, AsignadorAtomicoMemoria, AvanzarViaje, CancelarViaje, ConfirmarViaje,
  ConsultarChoferesOcupados, ConsultarDemandaPorZona, ConsultarViaje, CrearOferta, FinalizarViaje, GeneradorIdMemoria, RechazarOferta,
  RepositorioCobrosMemoria, RepositorioIdempotenciaMemoria, RepositorioOfertasMemoria,
  RepositorioViajesMemoria, type EstimacionVigente
} from "./dominio";
import { crearRouterViajes, ValidadorTokenFalso, type DependenciasViajes } from "./http";
import { ErrorDependenciaHttp } from "../compartido/cliente-servicios";

const ahoraPrueba = new Date();
const estimacion: EstimacionVigente = {
  id: "estimacion-http-1", origen: { latitud: -27.45, longitud: -58.98 }, destino: { latitud: -27.46, longitud: -58.99 },
  precioEstimado: "8086", moneda: "ARS", multiplicadorDemanda: 1.5,
  factoresPrecio: { zona_id: "resistencia", solicitudes_activas: 24, choferes_disponibles: 8 },
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
      otroChofer: { idUsuario: "chofer-2", rol: "CHOFER" }
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
    assert.equal(llegadaRepetida.status, 422);
    assert.equal((await llegadaRepetida.json() as { error: { codigo: string } }).error.codigo, "TRANSICION_INVALIDA");
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
