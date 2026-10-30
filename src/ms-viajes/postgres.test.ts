import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import {
  AceptarOferta,
  CancelarViaje,
  ConfirmarViaje,
  ErrorDominio,
  FinalizarViaje,
  GeneradorIdMemoria,
  type ActorAutenticado,
  type EstimacionVigente,
  type Oferta,
  type Viaje
} from "./dominio";
import {
  AsignadorAtomicoPostgres,
  ConsultarChoferesOcupadosPostgres,
  ConsultarDemandaPorZonaPostgres,
  RepositorioCobrosPostgres,
  RepositorioIdempotenciaPostgres,
  RepositorioOfertasPostgres,
  RepositorioViajesPostgres
} from "./postgres";

const disponible = Boolean(process.env.DATABASE_URL);
const PREFIJO = "test-postgres-";

async function limpiar(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM viajes.cobro WHERE viaje_id LIKE $1", [`${PREFIJO}%`]);
  await pool.query("DELETE FROM viajes.oferta WHERE viaje_id LIKE $1", [`${PREFIJO}%`]);
  await pool.query("DELETE FROM viajes.viaje WHERE id LIKE $1", [`${PREFIJO}%`]);
  await pool.query("DELETE FROM viajes.idempotencia WHERE actor_id LIKE $1", [`${PREFIJO}%`]);
}

test("adaptador PostgreSQL de ms-viajes: concurrencia, idempotencia e invariantes", { skip: !disponible }, async (t) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = await readFile("src/ms-viajes/schema.sql", "utf8");
  await pool.query(sql);
  await limpiar(pool);

  const repoViajes = new RepositorioViajesPostgres(pool);
  const repoOfertas = new RepositorioOfertasPostgres(pool);
  const repoCobros = new RepositorioCobrosPostgres(pool);
  const repoIdempotencia = new RepositorioIdempotenciaPostgres(pool);
  const asignador = new AsignadorAtomicoPostgres(pool);
  const ids = new GeneradorIdMemoria();

  t.after(async () => {
    await limpiar(pool);
    await pool.end();
  });

  await t.test("50 aceptaciones concurrentes dejan exactamente un ganador y 49 perdedores", async () => {
    const viajeId = `${PREFIJO}viaje-50`;
    const ahora = new Date();
    const expira = new Date(ahora.getTime() + 30_000);

    const viajeInicial: Viaje = {
      id: viajeId,
      pasajeroId: `${PREFIJO}pasajero-50`,
      origen: { latitud: -27.45, longitud: -58.98 },
      destino: { latitud: -27.46, longitud: -58.99 },
      estimacionId: `${PREFIJO}estimacion-50`,
      precioEstimado: "5000",
      moneda: "ARS",
      multiplicadorDemanda: 1.0,
      factoresPrecio: { zona_id: "centro" },
      estado: "SOLICITADO",
      creadoEn: ahora
    };
    await repoViajes.guardar(viajeInicial);

    const cantidadChoferes = 50;
    const ofertas: Oferta[] = [];
    for (let i = 0; i < cantidadChoferes; i++) {
      const oferta: Oferta = {
        id: `${PREFIJO}oferta-50-${i}`,
        viajeId,
        choferId: `${PREFIJO}chofer-50-${i}`,
        estado: "PENDIENTE",
        enviadaEm: ahora,
        expiraEm: expira
      };
      ofertas.push(await repoOfertas.guardar(oferta));
    }

    const casoDeUso = new AceptarOferta(repoOfertas, repoViajes, asignador);

    const promesas = ofertas.map((oferta) => {
      const actor: ActorAutenticado = {
        idUsuario: oferta.choferId,
        rol: "CHOFER"
      };
      return casoDeUso.ejecutar(actor, oferta.id, ahora);
    });

    const resultados = await Promise.allSettled(promesas);

    const cumplidos = resultados.filter((r) => r.status === "fulfilled");
    const rechazados = resultados.filter((r) => r.status === "rejected");

    assert.equal(cumplidos.length, 1, "Debe haber exactamente un ganador.");
    assert.equal(rechazados.length, cantidadChoferes - 1, "Los otros 49 deben ser rechazados.");

    for (const r of rechazados) {
      if (r.status === "rejected") {
        const err = r.reason as ErrorDominio;
        assert.ok(
          err.codigo === "VIAJE_NO_DISPONIBLE" || err.codigo === "ASIGNACION_EN_CONFLICTO",
          `Código inesperado de rechazo: ${err.codigo}`
        );
      }
    }

    const viajeFinal = await repoViajes.obtener(viajeId);
    assert.ok(viajeFinal);
    assert.equal(viajeFinal.estado, "ASIGNADO");
    assert.ok(viajeFinal.choferId?.startsWith(`${PREFIJO}chofer-50-`));
  });

  await t.test("un chofer no puede tener dos viajes activos (garantizado por índice único parcial)", async () => {
    const ahora = new Date();
    const expira = new Date(ahora.getTime() + 30_000);
    const choferId = `${PREFIJO}chofer-doble`;

    const viaje1: Viaje = {
      id: `${PREFIJO}viaje-doble-1`,
      pasajeroId: `${PREFIJO}pasajero-d1`,
      origen: { latitud: -27.45, longitud: -58.98 },
      destino: { latitud: -27.46, longitud: -58.99 },
      estimacionId: `${PREFIJO}est-d1`,
      precioEstimado: "4000",
      moneda: "ARS",
      multiplicadorDemanda: 1.0,
      factoresPrecio: {},
      estado: "SOLICITADO",
      creadoEn: ahora
    };
    const viaje2: Viaje = {
      id: `${PREFIJO}viaje-doble-2`,
      pasajeroId: `${PREFIJO}pasajero-d2`,
      origen: { latitud: -27.45, longitud: -58.98 },
      destino: { latitud: -27.46, longitud: -58.99 },
      estimacionId: `${PREFIJO}est-d2`,
      precioEstimado: "4200",
      moneda: "ARS",
      multiplicadorDemanda: 1.0,
      factoresPrecio: {},
      estado: "SOLICITADO",
      creadoEn: ahora
    };

    await repoViajes.guardar(viaje1);
    await repoViajes.guardar(viaje2);

    const oferta1: Oferta = {
      id: `${PREFIJO}oferta-d1`,
      viajeId: viaje1.id,
      choferId,
      estado: "PENDIENTE",
      enviadaEm: ahora,
      expiraEm: expira
    };
    const oferta2: Oferta = {
      id: `${PREFIJO}oferta-d2`,
      viajeId: viaje2.id,
      choferId,
      estado: "PENDIENTE",
      enviadaEm: ahora,
      expiraEm: expira
    };

    await repoOfertas.guardar(oferta1);
    await repoOfertas.guardar(oferta2);

    const casoDeUso = new AceptarOferta(repoOfertas, repoViajes, asignador);
    const actor: ActorAutenticado = { idUsuario: choferId, rol: "CHOFER" };

    const asignado1 = await casoDeUso.ejecutar(actor, oferta1.id, ahora);
    assert.equal(asignado1.estado, "ASIGNADO");

    await assert.rejects(
      () => casoDeUso.ejecutar(actor, oferta2.id, ahora),
      (err: unknown) => {
        const error = err as ErrorDominio;
        return error instanceof ErrorDominio && error.codigo === "ASIGNACION_EN_CONFLICTO";
      }
    );
  });

  await t.test("cancelación y aceptación simultáneas terminan en un estado determinista válido", async () => {
    const ahora = new Date();
    const expira = new Date(ahora.getTime() + 30_000);
    const viajeId = `${PREFIJO}viaje-carrera`;
    const pasajeroId = `${PREFIJO}pasajero-carrera`;
    const choferId = `${PREFIJO}chofer-carrera`;

    const viaje: Viaje = {
      id: viajeId,
      pasajeroId,
      origen: { latitud: -27.45, longitud: -58.98 },
      destino: { latitud: -27.46, longitud: -58.99 },
      estimacionId: `${PREFIJO}est-carrera`,
      precioEstimado: "3000",
      moneda: "ARS",
      multiplicadorDemanda: 1.0,
      factoresPrecio: {},
      estado: "SOLICITADO",
      creadoEn: ahora
    };
    await repoViajes.guardar(viaje);

    const oferta: Oferta = {
      id: `${PREFIJO}oferta-carrera`,
      viajeId,
      choferId,
      estado: "PENDIENTE",
      enviadaEm: ahora,
      expiraEm: expira
    };
    await repoOfertas.guardar(oferta);

    const aceptar = new AceptarOferta(repoOfertas, repoViajes, asignador);
    const cancelar = new CancelarViaje(repoViajes, asignador);

    const actorPasajero: ActorAutenticado = { idUsuario: pasajeroId, rol: "PASAJERO" };
    const actorChofer: ActorAutenticado = { idUsuario: choferId, rol: "CHOFER" };

    const [resAceptar, resCancelar] = await Promise.allSettled([
      aceptar.ejecutar(actorChofer, oferta.id, ahora),
      cancelar.ejecutar(actorPasajero, viajeId, "Cambio de planes", ahora)
    ]);

    const viajeEnBase = await repoViajes.obtener(viajeId);
    assert.ok(viajeEnBase);

    // Puede que la cancelación haya ganado antes de la aceptación:
    // en ese caso resCancelar cumplido, resAceptar rechazado con VIAJE_NO_DISPONIBLE.
    // O puede que la aceptación haya ganado primero: en ese caso resAceptar cumplido,
    // y resCancelar también se cumple cancelando el viaje ya asignado.
    // En cualquier orden, el estado final del viaje es consistente (no queda huérfano ni inconsistente).
    assert.ok(
      viajeEnBase.estado === "CANCELADO_POR_PASAJERO" || viajeEnBase.estado === "ASIGNADO",
      `Estado inválido tras carrera: ${viajeEnBase.estado}`
    );
  });

  await t.test("idempotencia en PostgreSQL: devuelve el mismo viaje y no reinserta", async () => {
    const pasajeroId = `${PREFIJO}pasajero-idemp`;
    const actor: ActorAutenticado = { idUsuario: pasajeroId, rol: "PASAJERO" };
    const ahora = new Date();
    const estimacion: EstimacionVigente = {
      id: `${PREFIJO}est-idemp`,
      origen: { latitud: -27.45, longitud: -58.98 },
      destino: { latitud: -27.46, longitud: -58.99 },
      precioEstimado: "2500",
      moneda: "ARS",
      multiplicadorDemanda: 1.0,
      factoresPrecio: { zona_id: "sur" },
      creadaEn: ahora,
      vigenteHasta: new Date(ahora.getTime() + 180_000)
    };

    const casoDeUso = new ConfirmarViaje(repoViajes, repoIdempotencia, ids);
    const clave = "clave-idempotencia-unica-123";

    const v1 = await casoDeUso.ejecutar(actor, estimacion, clave, ahora);
    const v2 = await casoDeUso.ejecutar(actor, estimacion, clave, ahora);

    assert.equal(v1.id, v2.id);
    assert.equal(v1.precioEstimado, v2.precioEstimado);

    const { rows } = await pool.query<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM viajes.viaje WHERE id = $1",
      [v1.id]
    );
    assert.equal(rows[0]?.total, "1");
  });

  await t.test("invariante 13: un viaje se cobra una sola vez", async () => {
    const ahora = new Date();
    const viajeId = `${PREFIJO}viaje-cobro`;
    const choferId = `${PREFIJO}chofer-cobro`;

    const viaje: Viaje = {
      id: viajeId,
      pasajeroId: `${PREFIJO}pasajero-cobro`,
      choferId,
      origen: { latitud: -27.45, longitud: -58.98 },
      destino: { latitud: -27.46, longitud: -58.99 },
      estimacionId: `${PREFIJO}est-cobro`,
      precioEstimado: "3500",
      moneda: "ARS",
      multiplicadorDemanda: 1.0,
      factoresPrecio: {},
      estado: "EN_CURSO",
      creadoEn: ahora,
      iniciadoEm: ahora
    };
    await repoViajes.guardar(viaje);

    const finalizar = new FinalizarViaje(repoViajes, repoCobros, asignador, ids);
    const actor: ActorAutenticado = { idUsuario: choferId, rol: "CHOFER" };

    const res1 = await finalizar.ejecutar(actor, viajeId, ahora);
    const res2 = await finalizar.ejecutar(actor, viajeId, ahora);

    assert.equal(res1.cobro.id, res2.cobro.id);
    assert.equal(res1.cobro.importe, "3500");

    const { rows } = await pool.query<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM viajes.cobro WHERE viaje_id = $1",
      [viajeId]
    );
    assert.equal(rows[0]?.total, "1");
  });

  await t.test("consultas de demanda por zona y choferes ocupados con SQL optimizado", async () => {
    const ahora = new Date();
    const zonaId = "zona-norte-test";

    const v1: Viaje = {
      id: `${PREFIJO}v-zona-1`,
      pasajeroId: `${PREFIJO}p1`,
      origen: { latitud: -27.45, longitud: -58.98 },
      destino: { latitud: -27.46, longitud: -58.99 },
      estimacionId: `${PREFIJO}e1`,
      precioEstimado: "2000",
      moneda: "ARS",
      multiplicadorDemanda: 1.2,
      factoresPrecio: { zona_id: zonaId },
      estado: "SOLICITADO",
      creadoEn: ahora
    };
    const v2: Viaje = {
      id: `${PREFIJO}v-zona-2`,
      pasajeroId: `${PREFIJO}p2`,
      choferId: `${PREFIJO}chofer-ocupado-sql`,
      origen: { latitud: -27.45, longitud: -58.98 },
      destino: { latitud: -27.46, longitud: -58.99 },
      estimacionId: `${PREFIJO}e2`,
      precioEstimado: "2000",
      moneda: "ARS",
      multiplicadorDemanda: 1.2,
      factoresPrecio: { zona_id: zonaId },
      estado: "ASIGNADO",
      creadoEn: ahora
    };

    await repoViajes.guardar(v1);
    await repoViajes.guardar(v2);

    const consultaDemanda = new ConsultarDemandaPorZonaPostgres(pool);
    const totalDemanda = await consultaDemanda.ejecutar(zonaId);
    assert.equal(totalDemanda, 1, "Solo cuenta los viajes en SOLICITADO para esa zona.");

    const consultaOcupacion = new ConsultarChoferesOcupadosPostgres(pool);
    const ocupados = await consultaOcupacion.ejecutar([
      `${PREFIJO}chofer-ocupado-sql`,
      `${PREFIJO}chofer-libre-sql`
    ]);
    assert.deepEqual(ocupados, [`${PREFIJO}chofer-ocupado-sql`]);
  });
});
