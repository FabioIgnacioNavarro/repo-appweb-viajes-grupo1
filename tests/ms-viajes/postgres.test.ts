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
} from "../../src/ms-viajes/dominio";
import {
  AsignadorAtomicoPostgres,
  ConsultarChoferesOcupadosPostgres,
  ConsultarDemandaPorZonaPostgres,
  EjecutorIdempotentePostgres,
  GeneradorIdUuid,
  RepositorioCobrosPostgres,
  RepositorioIdempotenciaPostgres,
  RepositorioOfertasPostgres,
  RepositorioViajesPostgres, TransaccionesViajesPostgres, type EjecutorSql
} from "../../src/ms-viajes/postgres";

const disponible = Boolean(process.env.DATABASE_URL);
const PREFIJO = "test-postgres-";

async function limpiar(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM viajes.cobro WHERE viaje_id LIKE $1", [`${PREFIJO}%`]);
  await pool.query("DELETE FROM viajes.oferta WHERE viaje_id LIKE $1", [`${PREFIJO}%`]);
  await pool.query("DELETE FROM viajes.viaje WHERE id LIKE $1 OR pasajero_usuario_id LIKE $1", [`${PREFIJO}%`]);
  await pool.query("DELETE FROM viajes.idempotencia WHERE actor_id LIKE $1", [`${PREFIJO}%`]);
}

test("el UPDATE de PostgreSQL limita cada transición al conjunto de estados anteriores permitido", async () => {
  const llamadas: Array<{ consulta: string; valores: unknown[] }> = [];
  const ejecutor = {
    async query(consulta: string, valores: unknown[] = []) {
      llamadas.push({ consulta, valores });
      if (consulta.includes("SELECT estado FROM viajes.viaje")) return { rows: [{ estado: "SOLICITADO" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  } as unknown as EjecutorSql;
  const repositorio = new RepositorioViajesPostgres(ejecutor);
  const viaje: Viaje = {
    id: "viaje-transicion-postgres", pasajeroId: "pasajero-1", origen: { latitud: -27.45, longitud: -58.98 },
    destino: { latitud: -27.46, longitud: -58.99 }, estimacionId: "estimacion-1", precioEstimado: "8086",
    moneda: "ARS", multiplicadorDemanda: 1.5, factoresPrecio: {}, estado: "CANCELADO_POR_PASAJERO", creadoEn: new Date()
  };
  await assert.rejects(
    () => repositorio.guardar(viaje),
    (error: unknown) => error instanceof ErrorDominio && error.codigo === "TRANSICION_ESTADO_INVALIDA"
  );
  const actualizacion = llamadas.find((llamada) => llamada.consulta.includes("UPDATE viajes.viaje"));
  assert.ok(actualizacion);
  assert.match(actualizacion.consulta, /estado = ANY\(\$9::text\[\]\)/);
  assert.deepEqual(actualizacion.valores[8], ["SOLICITADO", "ASIGNADO", "CHOFER_EN_CAMINO"]);
});

test("la unidad de trabajo bloquea primero viaje y luego oferta, confirma y libera la conexión", async () => {
  const consultas: string[] = [];
  let liberada = false;
  const cliente = {
    async query(consulta: string) {
      consultas.push(consulta);
      return { rows: [], rowCount: 0 };
    },
    release() { liberada = true; }
  };
  const pool = { async connect() { return cliente; } } as unknown as Pool;
  const transaccion = new TransaccionesViajesPostgres(pool);

  const resultado = await transaccion.ejecutar(async (repositorios) => {
    await repositorios.viajes.obtenerParaActualizar("viaje-1");
    await repositorios.ofertas.obtenerParaActualizar("oferta-1");
    return "confirmado";
  });

  assert.equal(resultado, "confirmado");
  assert.equal(consultas[0], "BEGIN");
  assert.match(consultas[1], /FROM viajes\.viaje WHERE id = \$1 FOR UPDATE/);
  assert.match(consultas[2], /FROM viajes\.oferta WHERE id = \$1 FOR UPDATE/);
  assert.equal(consultas[3], "COMMIT");
  assert.equal(liberada, true);
});

test("la unidad de trabajo revierte y libera si falla una escritura", async () => {
  const consultas: string[] = [];
  let liberada = false;
  const errorEsperado = new Error("fallo de persistencia simulado");
  const cliente = {
    async query(consulta: string) {
      consultas.push(consulta);
      if (consulta.includes("SELECT estado FROM viajes.viaje")) return { rows: [{ estado: "SOLICITADO" }], rowCount: 1 };
      if (consulta.includes("UPDATE viajes.viaje SET")) throw errorEsperado;
      return { rows: [], rowCount: 0 };
    },
    release() { liberada = true; }
  };
  const pool = { async connect() { return cliente; } } as unknown as Pool;
  const transaccion = new TransaccionesViajesPostgres(pool);
  const viaje: Viaje = {
    id: "viaje-fallo-transaccion", pasajeroId: "pasajero-1", origen: { latitud: -27.45, longitud: -58.98 },
    destino: { latitud: -27.46, longitud: -58.99 }, estimacionId: "estimacion-1", precioEstimado: "8086",
    moneda: "ARS", multiplicadorDemanda: 1.5, factoresPrecio: {}, estado: "ASIGNADO", choferId: "chofer-1", creadoEn: new Date()
  };

  await assert.rejects(() => transaccion.ejecutar(async ({ viajes }) => viajes.guardar(viaje)), errorEsperado);
  assert.equal(consultas[0], "BEGIN");
  assert.ok(consultas.some((consulta) => consulta.includes("UPDATE viajes.viaje SET")));
  assert.equal(consultas.at(-1), "ROLLBACK");
  assert.equal(liberada, true);
});

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
  const transaccion = new TransaccionesViajesPostgres(pool);
  const ids = new GeneradorIdMemoria();

  t.after(async () => {
    await limpiar(pool);
    await pool.end();
  });

  await t.test("la segunda petición espera los locks del viaje y la oferta y luego lee los estados confirmados", async () => {
    const viajeId = `${PREFIJO}viaje-lock-espera`;
    const ofertaId = `${PREFIJO}oferta-lock-espera`;
    const ahora = new Date();
    const choferId = `${PREFIJO}chofer-lock-espera`;
    await repoViajes.guardar({
      id: viajeId, pasajeroId: `${PREFIJO}pasajero-lock-espera`, origen: { latitud: -27.45, longitud: -58.98 },
      destino: { latitud: -27.46, longitud: -58.99 }, estimacionId: `${PREFIJO}estimacion-lock-espera`,
      precioEstimado: "5000", moneda: "ARS", multiplicadorDemanda: 1, factoresPrecio: {}, estado: "SOLICITADO", creadoEn: ahora
    });
    await repoOfertas.guardar({
      id: ofertaId, viajeId, choferId, estado: "PENDIENTE", enviadaEm: ahora, expiraEm: new Date(ahora.getTime() + 60_000)
    });

    const primera = await pool.connect();
    const segunda = await pool.connect();
    let primeraAbierta = false;
    let segundaAbierta = false;
    let consultaBloqueada: Promise<unknown> | undefined;
    try {
      await primera.query("BEGIN");
      primeraAbierta = true;
      const viajesPrimera = new RepositorioViajesPostgres(primera);
      const ofertasPrimera = new RepositorioOfertasPostgres(primera);
      const viaje = await viajesPrimera.obtenerParaActualizar(viajeId);
      const oferta = await ofertasPrimera.obtenerParaActualizar(ofertaId);
      assert.ok(viaje);
      assert.ok(oferta);

      await segunda.query("BEGIN");
      segundaAbierta = true;
      const pidResultado = await segunda.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const pidSegunda = pidResultado.rows[0].pid;
      const ofertasSegunda = new RepositorioOfertasPostgres(segunda);
      assert.equal((await ofertasSegunda.obtener(ofertaId))?.estado, "PENDIENTE");

      let avisarInicio: () => void = () => undefined;
      const inicioBloqueo = new Promise<void>((resolver) => { avisarInicio = resolver; });
      const ejecutorSegunda = {
        query(consulta: string, valores?: unknown[]) {
          if (consulta.includes("FROM viajes.viaje WHERE id = $1 FOR UPDATE")) avisarInicio();
          return segunda.query(consulta, valores as string[] | undefined);
        }
      } as unknown as EjecutorSql;
      consultaBloqueada = new RepositorioViajesPostgres(ejecutorSegunda).obtenerParaActualizar(viajeId);
      await inicioBloqueo;

      let bloqueoObservado = false;
      for (let intento = 0; intento < 100; intento += 1) {
        const bloqueos = await pool.query<{ bloqueado: boolean }>(
          "SELECT cardinality(pg_blocking_pids($1::integer)) > 0 AS bloqueado",
          [pidSegunda]
        );
        if (bloqueos.rows[0]?.bloqueado) { bloqueoObservado = true; break; }
        await new Promise((resolver) => setTimeout(resolver, 10));
      }
      assert.equal(bloqueoObservado, true, "la segunda conexión debe quedar esperando el lock de la primera");

      await viajesPrimera.guardar({ ...viaje, choferId, estado: "ASIGNADO" });
      await ofertasPrimera.guardar({ ...oferta, estado: "ACEPTADA", respondidaEm: ahora });
      await primera.query("COMMIT");
      primeraAbierta = false;

      const viajeReleido = await consultaBloqueada as Viaje | undefined;
      const ofertaReleida = await ofertasSegunda.obtenerParaActualizar(ofertaId);
      assert.equal(viajeReleido?.estado, "ASIGNADO");
      assert.equal(ofertaReleida?.estado, "ACEPTADA");
      await segunda.query("COMMIT");
      segundaAbierta = false;
    } finally {
      if (primeraAbierta) await primera.query("ROLLBACK").catch(() => undefined);
      if (consultaBloqueada) await consultaBloqueada.catch(() => undefined);
      if (segundaAbierta) await segunda.query("ROLLBACK").catch(() => undefined);
      primera.release();
      segunda.release();
    }
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

    const casoDeUso = new AceptarOferta(repoOfertas, repoViajes, asignador, undefined, transaccion);

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
          err.codigo === "VIAJE_NO_DISPONIBLE" || err.codigo === "ASIGNACION_EN_CONFLICTO" || err.codigo === "TRANSICION_ESTADO_INVALIDA",
          `Código inesperado de rechazo: ${err.codigo}`
        );
      }
    }

    const viajeFinal = await repoViajes.obtener(viajeId);
    assert.ok(viajeFinal);
    assert.equal(viajeFinal.estado, "ASIGNADO");
    assert.ok(viajeFinal.choferId?.startsWith(`${PREFIJO}chofer-50-`));
    const ofertasFinales = await repoOfertas.listarPorViaje(viajeId);
    assert.equal(ofertasFinales.filter((oferta) => oferta.estado === "ACEPTADA").length, 1);
    assert.equal(ofertasFinales.filter((oferta) => oferta.estado === "NO_SELECCIONADA").length, 49);
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

    const casoDeUso = new AceptarOferta(repoOfertas, repoViajes, asignador, undefined, transaccion);
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

    const aceptar = new AceptarOferta(repoOfertas, repoViajes, asignador, undefined, transaccion);
    const cancelar = new CancelarViaje(repoViajes, asignador);

    const actorPasajero: ActorAutenticado = { idUsuario: pasajeroId, rol: "PASAJERO" };
    const actorChofer: ActorAutenticado = { idUsuario: choferId, rol: "CHOFER" };

    const [_resAceptar, _resCancelar] = await Promise.allSettled([
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
      versionRegla: 1,
      creadaEn: ahora,
      vigenteHasta: new Date(ahora.getTime() + 180_000)
    };

    const casoDeUso = new ConfirmarViaje(repoViajes, repoIdempotencia, new GeneradorIdUuid(), new EjecutorIdempotentePostgres(pool));
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

  await t.test("idempotencia concurrente en PostgreSQL: 10 confirmaciones simultáneas crean exactamente un viaje", async () => {
    const pasajeroId = `${PREFIJO}pasajero-idemp-conc`;
    const actor: ActorAutenticado = { idUsuario: pasajeroId, rol: "PASAJERO" };
    const ahora = new Date();
    const estimacion: EstimacionVigente = {
      id: `${PREFIJO}est-idemp-conc`,
      origen: { latitud: -27.45, longitud: -58.98 },
      destino: { latitud: -27.46, longitud: -58.99 },
      precioEstimado: "3200",
      moneda: "ARS",
      multiplicadorDemanda: 1.25,
      factoresPrecio: { zona_id: "centro" },
      versionRegla: 1,
      creadaEn: ahora,
      vigenteHasta: new Date(ahora.getTime() + 180_000)
    };

    const casoDeUso = new ConfirmarViaje(
      repoViajes,
      repoIdempotencia,
      new GeneradorIdUuid(),
      new EjecutorIdempotentePostgres(pool)
    );
    const clave = "clave-concurrente-simultanea-postgres";

    const viajesCreados = await Promise.all(
      Array.from({ length: 10 }, () => casoDeUso.ejecutar(actor, estimacion, clave, ahora))
    );

    const idsUnicos = new Set(viajesCreados.map((v) => v.id));
    assert.equal(idsUnicos.size, 1, `Se esperaban 10 respuestas al mismo viaje, hubo ${idsUnicos.size}`);

    const { rows } = await pool.query<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM viajes.viaje WHERE estimacion_id = $1",
      [estimacion.id]
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
