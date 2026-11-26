import { strict as assert } from "node:assert";
import test from "node:test";
import { ErrorDependenciaHttp } from "../../src/compartido/cliente-servicios";
import { ConfirmarViaje, CrearOfertasParaCandidatos, GeneradorIdMemoria, MarcarViajeSinChoferesDisponibles, ProcesarVencimientoOfertas, RepositorioIdempotenciaMemoria, RepositorioOfertasMemoria, RepositorioViajesMemoria, type ActorAutenticado, type EstimacionVigente } from "../../src/ms-viajes/dominio";
import { ConfirmarViajeYBuscarChoferes } from "../../src/ms-viajes/integracion";

const actor: ActorAutenticado = { idUsuario: "pasajero-1", rol: "PASAJERO" };
const estimacion: EstimacionVigente = { id: "estimacion-1", origen: { latitud: -27.45, longitud: -58.98 }, destino: { latitud: -27.46, longitud: -58.99 }, precioEstimado: "8086", moneda: "ARS", multiplicadorDemanda: 1.5, factoresPrecio: { zona_id: "centro" }, versionRegla: 1, creadaEn: new Date(), vigenteHasta: new Date(Date.now() + 180_000) };

test("confirmación conserva exactamente precio e idempotencia, y crea ofertas solo una vez por candidato", async () => {
  const viajes = new RepositorioViajesMemoria(); const ofertas = new RepositorioOfertasMemoria(); const ids = new GeneradorIdMemoria();
  const caso = new ConfirmarViajeYBuscarChoferes(new ConfirmarViaje(viajes, new RepositorioIdempotenciaMemoria(), ids), { async buscar(_origen, jwt) { assert.equal(jwt, "jwt-pasajero"); return ["chofer-1", "chofer-1", "chofer-2"]; } }, new CrearOfertasParaCandidatos(ofertas, ids), new MarcarViajeSinChoferesDisponibles(viajes));
  const primero = await caso.ejecutar(actor, estimacion, "clave-1", "jwt-pasajero");
  const segundo = await caso.ejecutar(actor, estimacion, "clave-1", "jwt-pasajero");
  assert.equal(primero.id, segundo.id);
  assert.equal(segundo.precioEstimado, "8086");
  assert.equal(segundo.multiplicadorDemanda, 1.5);
  assert.equal((await ofertas.listarPorViaje(primero.id)).length, 2);
});

test("si flota cae, la operación falla cerrado y un reintento idempotente puede completar la búsqueda", async () => {
  const viajes = new RepositorioViajesMemoria(); const ofertas = new RepositorioOfertasMemoria(); const ids = new GeneradorIdMemoria();
  let disponible = false;
  const caso = new ConfirmarViajeYBuscarChoferes(new ConfirmarViaje(viajes, new RepositorioIdempotenciaMemoria(), ids), { async buscar() { if (!disponible) throw new ErrorDependenciaHttp("ms-flota", "buscar_candidatos"); return ["chofer-1"]; } }, new CrearOfertasParaCandidatos(ofertas, ids), new MarcarViajeSinChoferesDisponibles(viajes));
  await assert.rejects(() => caso.ejecutar(actor, estimacion, "clave-2", "jwt-pasajero"), ErrorDependenciaHttp);
  assert.equal((await viajes.listar()).length, 1);
  const viajesListados = await viajes.listar();
  assert.equal((await ofertas.listarPorViaje(viajesListados[0].id)).length, 0);
  disponible = true;
  const viajeReintentado = await caso.ejecutar(actor, estimacion, "clave-2", "jwt-pasajero");
  assert.equal((await viajes.listar()).length, 1);
  assert.equal(viajeReintentado.precioEstimado, "8086");
  assert.equal((await ofertas.listarPorViaje(viajeReintentado.id)).length, 1);
});

test("publica cada oferta nueva solo al chofer destinatario", async () => {
  const viajes = new RepositorioViajesMemoria(); const ofertas = new RepositorioOfertasMemoria(); const ids = new GeneradorIdMemoria();
  const publicaciones: Array<{ usuario: string; evento: string; datos: Record<string, unknown> }> = [];
  const eventos = { publicarAUsuario(usuario: string, evento: string, datos: Record<string, unknown>) { publicaciones.push({ usuario, evento, datos }); } };
  const caso = new ConfirmarViajeYBuscarChoferes(new ConfirmarViaje(viajes, new RepositorioIdempotenciaMemoria(), ids), { async buscar() { return ["chofer-1", "chofer-2"]; } }, new CrearOfertasParaCandidatos(ofertas, ids), new MarcarViajeSinChoferesDisponibles(viajes), eventos);
  await caso.ejecutar(actor, estimacion, "clave-eventos", "jwt-pasajero");
  assert.deepEqual(publicaciones.map((p) => p.usuario), ["chofer-1", "chofer-2"]);
  assert.ok(publicaciones.every((p) => p.evento === "OFERTA_NUEVA" && typeof p.datos.id_oferta === "string"));
});

test("si no hay candidatos, el viaje pasa a terminal y un reintento devuelve el estado actual", async () => {
  const viajes = new RepositorioViajesMemoria(); const ofertas = new RepositorioOfertasMemoria(); const ids = new GeneradorIdMemoria();
  let busquedas = 0;
  const caso = new ConfirmarViajeYBuscarChoferes(
    new ConfirmarViaje(viajes, new RepositorioIdempotenciaMemoria(), ids),
    { async buscar() { busquedas += 1; return []; } },
    new CrearOfertasParaCandidatos(ofertas, ids),
    new MarcarViajeSinChoferesDisponibles(viajes)
  );
  const primero = await caso.ejecutar(actor, estimacion, "clave-sin-choferes", "jwt-pasajero");
  const reintento = await caso.ejecutar(actor, estimacion, "clave-sin-choferes", "jwt-pasajero");
  assert.equal(primero.estado, "SIN_CHOFERES_DISPONIBLES");
  assert.equal(reintento.estado, "SIN_CHOFERES_DISPONIBLES");
  assert.equal(reintento.id, primero.id);
  assert.equal(busquedas, 1);
  assert.equal((await ofertas.listarPorViaje(primero.id)).length, 0);
});

test("vencimiento automático en servidor vence la oferta aunque el chofer no consulte y ofrece al siguiente chofer", async () => {
  const viajes = new RepositorioViajesMemoria();
  const ofertas = new RepositorioOfertasMemoria();
  const ids = new GeneradorIdMemoria();
  const sinChoferes = new MarcarViajeSinChoferesDisponibles(viajes);
  const crearOfertas = new CrearOfertasParaCandidatos(ofertas, ids);
  const eventos: Array<{ usuario: string; evento: string; datos: Record<string, unknown> }> = [];
  const publicador = { publicarAUsuario(usuario: string, evento: string, datos: Record<string, unknown>) { eventos.push({ usuario, evento, datos }); } };

  const confirmarConOfertas = new ConfirmarViajeYBuscarChoferes(
    new ConfirmarViaje(viajes, new RepositorioIdempotenciaMemoria(), ids),
    { async buscar() { return ["chofer-1", "chofer-2"]; } },
    crearOfertas,
    sinChoferes,
    publicador,
    { maxOfertasPorRonda: 1, vigenciaMs: 1000 }
  );

  const viaje = await confirmarConOfertas.ejecutar(actor, estimacion, "clave-auto-vence", "jwt-pasajero");
  const ofertasRonda1 = await ofertas.listarPorViaje(viaje.id);
  assert.equal(ofertasRonda1.length, 1);
  assert.equal(ofertasRonda1[0]!.choferId, "chofer-1");

  const procesador = new ProcesarVencimientoOfertas(
    ofertas,
    viajes,
    crearOfertas,
    sinChoferes,
    async () => ["chofer-1", "chofer-2"],
    publicador,
    { maxOfertasPorRonda: 1, vigenciaMs: 1000 }
  );

  const antesDeVencer = await procesador.ejecutar(new Date(ofertasRonda1[0]!.expiraEm.getTime() - 10));
  assert.equal(antesDeVencer.ofertasVencidas, 0);

  const trasPrimerVencimiento = await procesador.ejecutar(new Date(ofertasRonda1[0]!.expiraEm.getTime() + 10));
  assert.equal(trasPrimerVencimiento.ofertasVencidas, 1);
  assert.equal(trasPrimerVencimiento.ofertasReenviadas, 1);
  assert.equal(trasPrimerVencimiento.viajesSinChoferes, 0);

  const ofertasRonda2 = await ofertas.listarPorViaje(viaje.id);
  assert.equal(ofertasRonda2.length, 2);
  assert.equal(ofertasRonda2.find((o) => o.choferId === "chofer-1")?.estado, "VENCIDA");
  const ofertaChofer2 = ofertasRonda2.find((o) => o.choferId === "chofer-2");
  assert.equal(ofertaChofer2?.estado, "PENDIENTE");
  assert.ok(eventos.some((e) => e.usuario === "chofer-1" && e.evento === "OFERTA_VENCIDA"));
  assert.ok(eventos.some((e) => e.usuario === "chofer-2" && e.evento === "OFERTA_NUEVA"));

  const trasSegundoVencimiento = await procesador.ejecutar(new Date(ofertaChofer2!.expiraEm.getTime() + 10));
  assert.equal(trasSegundoVencimiento.ofertasVencidas, 1);
  assert.equal(trasSegundoVencimiento.ofertasReenviadas, 0);
  assert.equal(trasSegundoVencimiento.viajesSinChoferes, 1);
  assert.equal((await viajes.obtener(viaje.id))?.estado, "SIN_CHOFERES_DISPONIBLES");
  assert.ok(eventos.some((e) => e.usuario === "pasajero-1" && e.evento === "ESTADO_VIAJE_ACTUALIZADO" && e.datos.estado === "sin_choferes_disponibles"));
});
