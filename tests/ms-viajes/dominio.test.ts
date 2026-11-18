import { strict as assert } from "node:assert";
import test from "node:test";
import {
  AceptarOferta, ActorAutenticado, AsignadorAtomicoMemoria, AvanzarViaje, CancelarViaje,
  ConfirmarViaje, CrearOferta, ConsultarViaje, ErrorDominio, EstimacionVigente, FinalizarViaje,
  exigirTransicionViaje, GeneradorIdMemoria, RepositorioCobrosMemoria, RepositorioIdempotenciaMemoria,
  RepositorioOfertasMemoria, RepositorioViajesMemoria, transicionPermitidaViaje,
  transicionesViajePermitidas, type EstadoViaje, type Oferta, type RepositoriosViajeTransaccionales, type TransaccionViajes
} from "../../src/ms-viajes/dominio";

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

test("la matriz exhaustiva acepta solo las transiciones documentadas y rechaza todas las demás", () => {
  const esperada: Record<EstadoViaje, readonly EstadoViaje[]> = {
    SOLICITADO: ["ASIGNADO", "SIN_CHOFERES_DISPONIBLES", "CANCELADO_POR_PASAJERO", "CANCELADO_POR_OPERADOR"],
    ASIGNADO: ["CHOFER_EN_CAMINO", "CANCELADO_POR_PASAJERO", "CANCELADO_POR_CHOFER", "CANCELADO_POR_OPERADOR"],
    CHOFER_EN_CAMINO: ["EN_CURSO", "CANCELADO_POR_PASAJERO", "CANCELADO_POR_CHOFER", "CANCELADO_POR_OPERADOR"],
    EN_CURSO: ["FINALIZADO", "CANCELADO_POR_OPERADOR"],
    FINALIZADO: [], CANCELADO_POR_PASAJERO: [], CANCELADO_POR_CHOFER: [], CANCELADO_POR_OPERADOR: [],
    SIN_CHOFERES_DISPONIBLES: []
  };
  assert.deepEqual(transicionesViajePermitidas, esperada);
  const estados = Object.keys(esperada) as EstadoViaje[];
  for (const origen of estados) {
    for (const destino of estados) {
      const valida = esperada[origen].includes(destino);
      assert.equal(transicionPermitidaViaje(origen, destino), valida, `${origen} → ${destino}`);
      if (valida) assert.doesNotThrow(() => exigirTransicionViaje(origen, destino));
      else assert.throws(
        () => exigirTransicionViaje(origen, destino),
        (error: unknown) => error instanceof ErrorDominio && error.codigo === "TRANSICION_ESTADO_INVALIDA",
        `${origen} → ${destino} debe rechazarse con error de transición`
      );
    }
  }
});

test("confirma un viaje y congela el precio y los factores", async () => {
  const ctx = contexto();
  const viaje = await ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  assert.equal(viaje.estado, "SOLICITADO");
  assert.equal(viaje.precioEstimado, "8086");
  assert.equal(viaje.multiplicadorDemanda, 1.5);
  assert.deepEqual(viaje.factoresPrecio, { solicitudesActivas: 24, choferesDisponibles: 8 });
});

test("la misma clave de idempotencia devuelve el mismo viaje", async () => {
  const ctx = contexto();
  const primero = await ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  const segundo = await ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  assert.equal(segundo.id, primero.id);
  assert.equal(await ctx.viajes.obtener("viaje-2"), undefined);
});

test("rechaza una estimacion vencida", async () => {
  const ctx = contexto();
  await assert.rejects(
    async () => await ctx.confirmar.ejecutar(pasajero, estimacion(new Date(Date.now() - 1)), "clave-1"),
    (error: unknown) => error instanceof ErrorDominio && error.codigo === "ESTIMACION_VENCIDA"
  );
});

test("impide consultar un viaje ajeno", async () => {
  const ctx = contexto();
  const viaje = await ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  await assert.rejects(
    async () => await new ConsultarViaje(ctx.viajes).ejecutar({ idUsuario: "otro", rol: "PASAJERO" }, viaje.id),
    (error: unknown) => error instanceof ErrorDominio && error.codigo === "VIAJE_NO_AUTORIZADO"
  );
});

test("cincuenta aceptaciones dejan un unico ganador", async () => {
  const ctx = contexto();
  const viaje = await ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  const crearOferta = new CrearOferta(ctx.ofertas, ctx.viajes, ctx.ids);
  const choferes = Array.from({ length: 50 }, (_, i) => `chofer-${i}`);
  const ofertas: Oferta[] = [];
  for (const id of choferes) {
    ofertas.push(await crearOferta.ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje.id, id, new Date(Date.now() + 60_000)));
  }
  let ganadores = 0;
  for (const oferta of ofertas) {
    try {
      await new AceptarOferta(ctx.ofertas, ctx.viajes, ctx.asignador).ejecutar({ idUsuario: oferta.choferId, rol: "CHOFER" }, oferta.id);
      ganadores += 1;
    } catch { /* perdedores esperados */ }
  }
  assert.equal(ganadores, 1);
  assert.equal((await ctx.viajes.obtener(viaje.id))?.estado, "ASIGNADO");
});

test("la aceptación transaccional bloquea el viaje antes de la oferta y conserva la regla de dominio", async () => {
  const ctx = contexto();
  const viaje = await ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-lock-orden");
  const oferta = await new CrearOferta(ctx.ofertas, ctx.viajes, ctx.ids).ejecutar(
    { idUsuario: "soporte", rol: "SOPORTE" }, viaje.id, "chofer-1", new Date(Date.now() + 60_000)
  );
  const orden: string[] = [];
  const transaccion: TransaccionViajes = {
    async ejecutar<T>(operacion: (repositorios: RepositoriosViajeTransaccionales) => Promise<T>): Promise<T> {
      return operacion({
        viajes: {
          guardar: (valor: typeof viaje) => ctx.viajes.guardar(valor),
          obtener: (id: string) => ctx.viajes.obtener(id),
          obtenerParaActualizar: (id: string) => { orden.push("bloquear_viaje"); return ctx.viajes.obtener(id); },
          obtenerActivoPorChofer: (id: string) => ctx.viajes.obtenerActivoPorChofer(id),
          listar: () => ctx.viajes.listar()
        },
        ofertas: {
          guardar: (valor: typeof oferta) => ctx.ofertas.guardar(valor),
          obtener: (id: string) => { orden.push("leer_oferta"); return ctx.ofertas.obtener(id); },
          obtenerParaActualizar: (id: string) => { orden.push("bloquear_oferta"); return ctx.ofertas.obtener(id); },
          listarPorChofer: (id: string) => ctx.ofertas.listarPorChofer(id),
          listarPorViaje: (id: string) => ctx.ofertas.listarPorViaje(id)
        }
      });
    }
  };

  const asignado = await new AceptarOferta(ctx.ofertas, ctx.viajes, ctx.asignador, undefined, transaccion)
    .ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, oferta.id);
  assert.deepEqual(orden.slice(0, 3), ["leer_oferta", "bloquear_viaje", "bloquear_oferta"]);
  assert.equal(asignado.estado, "ASIGNADO");
  assert.equal((await ctx.ofertas.obtener(oferta.id))?.estado, "ACEPTADA");
});

test("un chofer no puede aceptar dos viajes activos", async () => {
  const ctx = contexto();
  const viaje1 = await ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  const viaje2 = await ctx.confirmar.ejecutar({ idUsuario: "pasajero-2", rol: "PASAJERO" }, estimacion(), "clave-2");
  const crearOferta = new CrearOferta(ctx.ofertas, ctx.viajes, ctx.ids);
  const oferta1 = await crearOferta.ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje1.id, "chofer-1", new Date(Date.now() + 60_000));
  const oferta2 = await crearOferta.ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje2.id, "chofer-1", new Date(Date.now() + 60_000));
  const aceptar = new AceptarOferta(ctx.ofertas, ctx.viajes, ctx.asignador);
  await aceptar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, oferta1.id);
  await assert.rejects(
    async () => await aceptar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, oferta2.id),
    (error: unknown) => error instanceof ErrorDominio && error.codigo === "ASIGNACION_EN_CONFLICTO"
  );
});

test("la cancelacion y la aceptacion simultaneas dejan un resultado valido", async () => {
  const ctx = contexto();
  const viaje = await ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  const crearOferta = new CrearOferta(ctx.ofertas, ctx.viajes, ctx.ids);
  const oferta = await crearOferta.ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje.id, "chofer-1", new Date(Date.now() + 60_000));
  const aceptar = new AceptarOferta(ctx.ofertas, ctx.viajes, ctx.asignador);
  await new CancelarViaje(ctx.viajes, ctx.asignador).ejecutar(pasajero, viaje.id, "ya no necesito el viaje");
  await assert.rejects(
    async () => await aceptar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, oferta.id),
    (error: unknown) => error instanceof ErrorDominio && error.codigo === "TRANSICION_ESTADO_INVALIDA"
  );
  assert.equal((await ctx.viajes.obtener(viaje.id))?.estado, "CANCELADO_POR_PASAJERO");
});

test("cancelar y finalizar respetan autorizacion y cobran una sola vez", async () => {
  const ctx = contexto();
  const viaje = await ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-1");
  const crearOferta = new CrearOferta(ctx.ofertas, ctx.viajes, ctx.ids);
  const oferta = await crearOferta.ejecutar({ idUsuario: "soporte", rol: "SOPORTE" }, viaje.id, "chofer-1", new Date(Date.now() + 60_000));
  await new AceptarOferta(ctx.ofertas, ctx.viajes, ctx.asignador).ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, oferta.id);
  const avanzar = new AvanzarViaje(ctx.viajes);
  await avanzar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, viaje.id, "CHOFER_EN_CAMINO");
  await avanzar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, viaje.id, "EN_CURSO");
  const finalizar = new FinalizarViaje(ctx.viajes, ctx.cobros, ctx.asignador, ctx.ids);
  const primero = await finalizar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, viaje.id);
  assert.equal(primero.viaje.estado, "FINALIZADO");
  const segundo = await finalizar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, viaje.id);
  assert.equal(segundo.cobro.id, primero.cobro.id);
  await assert.rejects(
    async () => await new CancelarViaje(ctx.viajes, ctx.asignador).ejecutar(pasajero, viaje.id, "tarde"),
    (error: unknown) => error instanceof ErrorDominio && error.codigo === "TRANSICION_ESTADO_INVALIDA"
  );
});

test("el pasajero no puede cancelar un viaje en curso, pero soporte puede por transición de operador", async () => {
  const ctx = contexto();
  const viaje = await ctx.confirmar.ejecutar(pasajero, estimacion(), "clave-cancelacion-en-curso");
  const oferta = await new CrearOferta(ctx.ofertas, ctx.viajes, ctx.ids).ejecutar(
    { idUsuario: "soporte", rol: "SOPORTE" }, viaje.id, "chofer-1", new Date(Date.now() + 60_000)
  );
  await new AceptarOferta(ctx.ofertas, ctx.viajes, ctx.asignador).ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, oferta.id);
  const avanzar = new AvanzarViaje(ctx.viajes);
  await avanzar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, viaje.id, "CHOFER_EN_CAMINO");
  await avanzar.ejecutar({ idUsuario: "chofer-1", rol: "CHOFER" }, viaje.id, "EN_CURSO");

  await assert.rejects(
    () => new CancelarViaje(ctx.viajes, ctx.asignador).ejecutar(pasajero, viaje.id, "tarde"),
    (error: unknown) => error instanceof ErrorDominio && error.codigo === "TRANSICION_ESTADO_INVALIDA"
  );
  const cancelado = await new CancelarViaje(ctx.viajes, ctx.asignador).ejecutar(
    { idUsuario: "soporte", rol: "SOPORTE" }, viaje.id, "incidente"
  );
  assert.equal(cancelado.estado, "CANCELADO_POR_OPERADOR");
});
