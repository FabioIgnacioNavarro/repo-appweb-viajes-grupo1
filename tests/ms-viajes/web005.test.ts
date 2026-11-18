import assert from "node:assert/strict";
import test from "node:test";
import {
  AceptarOferta, ActorAutenticado, AsignadorAtomicoMemoria, AvanzarViaje, ConfirmarViaje,
  ConsultarCobro, CrearOferta, ErrorDominio, FinalizarViaje, GeneradorIdMemoria,
  ReintentarCobro, RepositorioCobrosMemoria, RepositorioIdempotenciaMemoria,
  RepositorioOfertasMemoria, RepositorioViajesMemoria, type EstimacionVigente
} from "../../src/ms-viajes/dominio";
import { PasarelaPagosFalsa } from "../../src/ms-viajes/pasarela-pagos-falsa";

const pasajero: ActorAutenticado = { idUsuario: "pasajero-web005", rol: "PASAJERO" };
const chofer: ActorAutenticado = { idUsuario: "chofer-web005", rol: "CHOFER" };
const estimacion: EstimacionVigente = {
  id: "estimacion-web005", origen: { latitud: -27.45, longitud: -58.98 }, destino: { latitud: -27.46, longitud: -58.99 },
  precioEstimado: "8086", moneda: "ARS", multiplicadorDemanda: 1.25,
  factoresPrecio: { zona: "centro" }, versionRegla: 1,
  creadaEn: new Date(), vigenteHasta: new Date(Date.now() + 180_000)
};

async function prepararViajeFinalizado() {
  const viajes = new RepositorioViajesMemoria();
  const ofertas = new RepositorioOfertasMemoria();
  const cobros = new RepositorioCobrosMemoria();
  const idempotencia = new RepositorioIdempotenciaMemoria();
  const asignador = new AsignadorAtomicoMemoria();
  const ids = new GeneradorIdMemoria();
  const pasarela = new PasarelaPagosFalsa();
  const viaje = await new ConfirmarViaje(viajes, idempotencia, ids).ejecutar(pasajero, estimacion, "confirmar-web005");
  const oferta = await new CrearOferta(ofertas, viajes, ids).ejecutar(
    { idUsuario: "soporte-web005", rol: "SOPORTE" }, viaje.id, chofer.idUsuario, new Date(Date.now() + 60_000)
  );
  await new AceptarOferta(ofertas, viajes, asignador).ejecutar(chofer, oferta.id);
  const avanzar = new AvanzarViaje(viajes);
  await avanzar.ejecutar(chofer, viaje.id, "CHOFER_EN_CAMINO");
  await avanzar.ejecutar(chofer, viaje.id, "EN_CURSO");
  const finalizar = new FinalizarViaje(viajes, cobros, asignador, ids, pasarela);
  const resultado = await finalizar.ejecutar(chofer, viaje.id);
  return { viajes, cobros, idempotencia, ids, pasarela, finalizar, viaje: resultado.viaje, cobro: resultado.cobro };
}

test("WEB-005: finalizar repetidamente conserva un solo cobro y el precio congelado", async () => {
  const ctx = await prepararViajeFinalizado();
  const repetido = await ctx.finalizar.ejecutar(chofer, ctx.viaje.id);
  const guardado = await ctx.cobros.obtenerPorViaje(ctx.viaje.id);

  assert.equal(ctx.cobro.estado, "FALLIDO");
  assert.equal(ctx.cobro.intentos, 1);
  assert.equal(ctx.cobro.importe, "8086");
  assert.equal(repetido.cobro.id, ctx.cobro.id);
  assert.equal(guardado?.id, ctx.cobro.id);
  assert.equal(repetido.viaje.precioFinal, "8086");
});

test("WEB-005: reintentar un cobro fallido confirma el mismo cobro y la clave reproduce el resultado", async () => {
  const ctx = await prepararViajeFinalizado();
  const reintentar = new ReintentarCobro(ctx.viajes, ctx.cobros, ctx.idempotencia, ctx.pasarela);
  const primero = await reintentar.ejecutar(pasajero, ctx.viaje.id, "reintento-1");
  const repetido = await reintentar.ejecutar(pasajero, ctx.viaje.id, "reintento-1");
  const nuevoIntentoTrasConfirmar = await reintentar.ejecutar(pasajero, ctx.viaje.id, "reintento-2");

  assert.equal(primero.estado, "CONFIRMADO");
  assert.equal(primero.intentos, 2);
  assert.equal(primero.id, ctx.cobro.id);
  assert.equal(primero.importe, "8086");
  assert.deepEqual(repetido, primero);
  assert.deepEqual(nuevoIntentoTrasConfirmar, primero);
  assert.deepEqual(await ctx.cobros.obtenerPorViaje(ctx.viaje.id), primero);

  await assert.rejects(
    () => reintentar.ejecutar(chofer, ctx.viaje.id, "reintento-chofer"),
    (error: unknown) => error instanceof ErrorDominio && error.codigo === "COBRO_NO_AUTORIZADO"
  );
});

test("WEB-005: el recibo solo lo consultan pasajero titular, chofer asignado y soporte", async () => {
  const ctx = await prepararViajeFinalizado();
  const consultar = new ConsultarCobro(ctx.viajes, ctx.cobros);

  assert.equal((await consultar.ejecutar(pasajero, ctx.viaje.id)).id, ctx.cobro.id);
  assert.equal((await consultar.ejecutar(chofer, ctx.viaje.id)).id, ctx.cobro.id);
  assert.equal((await consultar.ejecutar({ idUsuario: "soporte-web005", rol: "SOPORTE" }, ctx.viaje.id)).id, ctx.cobro.id);
  await assert.rejects(
    () => consultar.ejecutar({ idUsuario: "otro-pasajero", rol: "PASAJERO" }, ctx.viaje.id),
    (error: unknown) => error instanceof ErrorDominio && error.codigo === "COBRO_NO_AUTORIZADO"
  );
});
