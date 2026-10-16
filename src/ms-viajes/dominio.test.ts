import { strict as assert } from "node:assert";
import test from "node:test";
import {
  AceptarOferta, ActorAutenticado, AsignadorAtomicoMemoria, AvanzarViaje, CancelarViaje,
  ConfirmarViaje, CrearOferta, ConsultarViaje, ErrorDominio, EstimacionVigente, FinalizarViaje,
  GeneradorIdMemoria, RepositorioCobrosMemoria, RepositorioIdempotenciaMemoria,
  RepositorioOfertasMemoria, RepositorioViajesMemoria
} from "./dominio";

const pasajero: ActorAutenticado = { idUsuario: "pasajero-1", rol: "PASAJERO" };
const estimacion = (vigenteHasta = new Date(Date.now() + 180_000)): EstimacionVigente => ({
  id: "estimacion-1", origen: { latitud: -27.45, longitud: -58.98 }, destino: { latitud: -27.46, longitud: -58.99 },
  precioEstimado: "8086", moneda: "ARS", multiplicadorDemanda: 1.5, factoresPrecio: { solicitudesActivas: 24, choferesDisponibles: 8 },
  creadaEn: new Date(), vigenteHasta
});

function contexto() {
  const viajes = new RepositorioViajesMemoria();
  const ofertas = new RepositorioOfertasMemoria();
  const cobros = new RepositorioCobrosMemoria();
  const asignador = new AsignadorAtomicoMemoria();
  const ids = new GeneradorIdMemoria();
  const confirmar = new ConfirmarViaje(viajes, new RepositorioIdempotenciaMemoria(), ids);
  return { viajes, ofertas, cobros, asignador, ids, confirmar };
}

test("confirma un viaje y congela el precio y los factores", () => {
  const ctx = contexto();
  const viaje = ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  assert.equal(viaje.estado, "SOLICITADO");
  assert.equal(viaje.precioEstimado, "8086");
  assert.equal(viaje.multiplicadorDemanda, 1.5);
  assert.deepEqual(viaje.factoresPrecio, { solicitudesActivas: 24, choferesDisponibles: 8 });
});

test("la misma clave de idempotencia devuelve el mismo viaje", () => {
  const ctx = contexto();
  const primero = ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  const segundo = ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  assert.equal(segundo.id, primero.id);
  assert.equal(ctx.viajes.obtener("viaje-2"), undefined);
});

test("rechaza una estimacion vencida", () => {
  const ctx = contexto();
  assert.throws(() => ctx.confirmar.ejecutar(pasajero, estimacion(new Date(Date.now() - 1)), "clave-1"), (error: unknown) => error instanceof ErrorDominio && error.codigo === "ESTIMACION_VENCIDA");
});

test("impide consultar un viaje ajeno", () => {
  const ctx = contexto();
  const viaje = ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  assert.throws(() => new ConsultarViaje(ctx.viajes).ejecutar({ idUsuario: "otro", rol: "PASAJERO" }, viaje.id), (error: unknown) => error instanceof ErrorDominio && error.codigo === "VIAJE_NO_AUTORIZADO");
});

test("cincuenta aceptaciones dejan un unico ganador", () => {
  const ctx = contexto();
  const viaje = ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  const crearOferta = new CrearOferta(ctx.ofertas, ctx.viajes, ctx.ids);
  const choferes = Array.from({ length: 50 }, (_, i) => `chofer-${i}`);
  const ofertas = choferes.map((id) => crearOferta.ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje.id, id, new Date(Date.now() + 60_000)));
  let ganadores = 0;
  for (const oferta of ofertas) {
    try { new AceptarOferta(ctx.ofertas, ctx.viajes, ctx.asignador).ejecutar({ idUsuario: oferta.choferId, rol: "CHOFER" }, oferta.id); ganadores += 1; } catch { /* perdedores esperados */ }
  }
  assert.equal(ganadores, 1);
  assert.equal(ctx.viajes.obtener(viaje.id)?.estado, "ASIGNADO");
});

test("un chofer no puede aceptar dos viajes activos", () => {
  const ctx = contexto();
  const viaje1 = ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  const viaje2 = ctx.confirmar.ejecutar({ idUsuario: "pasajero-2", rol: "PASAJERO" }, estimacion(), "clave-2");
  const crearOferta = new CrearOferta(ctx.ofertas, ctx.viajes, ctx.ids);
  const oferta1 = crearOferta.ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje1.id, "chofer-1", new Date(Date.now() + 60_000));
  const oferta2 = crearOferta.ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje2.id, "chofer-1", new Date(Date.now() + 60_000));
  const aceptar = new AceptarOferta(ctx.ofertas, ctx.viajes, ctx.asignador);
  aceptar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, oferta1.id);
  assert.throws(() => aceptar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, oferta2.id), (error: unknown) => error instanceof ErrorDominio && error.codigo === "ASIGNACION_EN_CONFLICTO");
});

test("la cancelacion y la aceptacion simultaneas dejan un resultado valido", () => {
  const ctx = contexto();
  const viaje = ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  const crearOferta = new CrearOferta(ctx.ofertas, ctx.viajes, ctx.ids);
  const oferta = crearOferta.ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje.id, "chofer-1", new Date(Date.now() + 60_000));
  const aceptar = new AceptarOferta(ctx.ofertas, ctx.viajes, ctx.asignador);
  new CancelarViaje(ctx.viajes, ctx.asignador).ejecutar(pasajero, viaje.id, "ya no necesito el viaje");
  assert.throws(() => aceptar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, oferta.id), (error: unknown) => error instanceof ErrorDominio && error.codigo === "VIAJE_NO_DISPONIBLE");
  assert.equal(ctx.viajes.obtener(viaje.id)?.estado, "CANCELADO_POR_PASAJERO");
});

test("cancelar y finalizar respetan autorizacion y cobran una sola vez", () => {
  const ctx = contexto();
  const viaje = ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  const crearOferta = new CrearOferta(ctx.ofertas, ctx.viajes, ctx.ids);
  const oferta = crearOferta.ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje.id, "chofer-1", new Date(Date.now() + 60_000));
  new AceptarOferta(ctx.ofertas, ctx.viajes, ctx.asignador).ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, oferta.id);
  const avanzar = new AvanzarViaje(ctx.viajes);
  avanzar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, viaje.id, "CHOFER_EN_CAMINO");
  avanzar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, viaje.id, "EN_CURSO");
  const finalizar = new FinalizarViaje(ctx.viajes, ctx.cobros, ctx.asignador, ctx.ids);
  const primero = finalizar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, viaje.id);
  assert.equal(primero.viaje.estado, "FINALIZADO");
  assert.equal(finalizar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, viaje.id).cobro.id, primero.cobro.id);
  assert.throws(() => new CancelarViaje(ctx.viajes, ctx.asignador).ejecutar(pasajero, viaje.id, "tarde"), (error: unknown) => error instanceof ErrorDominio && error.codigo === "VIAJE_TERMINAL");
});
