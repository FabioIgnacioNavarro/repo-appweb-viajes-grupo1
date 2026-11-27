import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { PurgarUbicacionesHistoricasVencidas } from "../../src/ms-flota/dominio";
import { RepositorioChoferesPostgres, RepositorioUbicacionesPostgres, RepositorioVehiculosPostgres } from "../../src/ms-flota/postgres";

const disponible = Boolean(process.env.DATABASE_URL);

test("persistencia real de disponibilidad y ubicación en PostgreSQL", { skip: !disponible }, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const usuarioId = "00000000-0000-0000-0000-000000000021";
  const perfilId = "00000000-0000-0000-0000-000000000022";
  try {
    await pool.query(await readFile("src/ms-flota/schema.sql", "utf8"));
    await pool.query("DELETE FROM ubicacion_actual WHERE usuario_id = $1", [usuarioId]);
    await pool.query("DELETE FROM usuario_chofer WHERE usuario_id = $1", [usuarioId]);
    await pool.query("INSERT INTO usuario_chofer (id, usuario_id, habilitado, disponibilidad, carnet_conducir_validado) VALUES ($1, $2, TRUE, FALSE, TRUE)", [perfilId, usuarioId]);
    const choferes = new RepositorioChoferesPostgres(pool);
    const choferesIngenuo = new RepositorioChoferesPostgres(pool, "ingenua");
    const ubicaciones = new RepositorioUbicacionesPostgres(pool, randomUUID);
    const chofer = await choferes.obtenerPorUsuario(usuarioId);
    assert.equal(chofer?.disponibilidad, false);
    await choferes.guardar({ ...chofer!, disponibilidad: true, fechaActualizacion: new Date() });
    assert.equal((await choferes.obtenerPorUsuario(usuarioId))?.disponibilidad, true);
    const nueva = await ubicaciones.guardarSiEsMasNueva({ id: "", usuarioId, latitud: -27.45, longitud: -58.98, actualizadoAt: new Date("2026-10-15T12:00:05Z") });
    const anterior = await ubicaciones.guardarSiEsMasNueva({ id: "", usuarioId, latitud: -27.46, longitud: -58.99, actualizadoAt: new Date("2026-10-15T12:00:01Z") });
    assert.equal(nueva.latitud, anterior.latitud);

    const opt = await choferes.buscarDisponiblesCercanos({ latitud: -27.45, longitud: -58.98 }, 5000, new Date("2026-10-15T12:00:10Z"), 30_000);
    const ing = await choferesIngenuo.buscarDisponiblesCercanos({ latitud: -27.45, longitud: -58.98 }, 5000, new Date("2026-10-15T12:00:10Z"), 30_000);
    assert.equal(opt.some((c) => c.usuarioId === usuarioId), true);
    assert.equal(ing.some((c) => c.usuarioId === usuarioId), true);

    const vehiculos = new RepositorioVehiculosPostgres(pool);
    const vehiculoId = "00000000-0000-0000-0000-000000000024";
    await pool.query("DELETE FROM chofer_vehiculo WHERE usuario_chofer_id = $1", [perfilId]);
    await pool.query("DELETE FROM vehiculo WHERE id = $1 OR patente = 'PG999AA'", [vehiculoId]);
    await vehiculos.guardar({
      id: vehiculoId, patente: "PG999AA", tipoVehiculo: "AUTOMOVIL", marca: "VW", modelo: "Polo",
      anioFabricacion: 2024, color: "Azul", capacidadPasajeros: 4, estado: "ACTIVO",
      createdAt: new Date(), updatedAt: new Date()
    });
    await vehiculos.asignarAChofer(perfilId, vehiculoId, "00000000-0000-0000-0000-000000000025", new Date());
    assert.equal((await vehiculos.obtenerVehiculoActivoDeChofer(perfilId))?.patente, "PG999AA");

    await pool.query("DELETE FROM ubicacion_historica WHERE usuario_id = $1", [usuarioId]);
    await ubicaciones.registrarHistoricaSiCorresponde({ id: "", usuarioId, latitud: -27.45, longitud: -58.98, actualizadoAt: new Date("2026-07-01T12:00:00Z") }, 15_000);
    await ubicaciones.registrarHistoricaSiCorresponde({ id: "", usuarioId, latitud: -27.451, longitud: -58.981, actualizadoAt: new Date("2026-10-10T12:00:00Z") }, 15_000);
    const purga = await new PurgarUbicacionesHistoricasVencidas(ubicaciones, 60).ejecutar(new Date("2026-10-15T12:00:00Z"));
    assert.ok(purga.eliminados >= 1);
    const restantes = await pool.query("SELECT COUNT(*)::int AS c FROM ubicacion_historica WHERE usuario_id = $1", [usuarioId]);
    assert.equal(restantes.rows[0]?.c, 1);
  } finally {
    await pool.query("DELETE FROM chofer_vehiculo WHERE usuario_chofer_id = $1", [perfilId]);
    await pool.query("DELETE FROM vehiculo WHERE id = '00000000-0000-0000-0000-000000000024' OR patente = 'PG999AA'");
    await pool.query("DELETE FROM ubicacion_historica WHERE usuario_id = $1", [usuarioId]);
    await pool.query("DELETE FROM ubicacion_actual WHERE usuario_id = $1", [usuarioId]);
    await pool.query("DELETE FROM usuario_chofer WHERE usuario_id = $1", [usuarioId]);
    await pool.end();
  }
});
