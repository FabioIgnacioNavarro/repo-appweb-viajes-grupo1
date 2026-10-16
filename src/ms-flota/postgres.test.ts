import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { RepositorioChoferesPostgres, RepositorioUbicacionesPostgres } from "./postgres";

const disponible = Boolean(process.env.DATABASE_URL);

test("persistencia real de disponibilidad y ubicación en PostgreSQL", { skip: !disponible }, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const usuarioId = "00000000-0000-0000-0000-000000000021";
  const perfilId = "00000000-0000-0000-0000-000000000022";
  try {
    await pool.query(await readFile("src/ms-flota/schema.sql", "utf8"));
    await pool.query("DELETE FROM ubicacion_actual WHERE usuario_id = $1; DELETE FROM usuario_chofer WHERE usuario_id = $1", [usuarioId]);
    await pool.query("INSERT INTO usuario_chofer (id, usuario_id, habilitado, disponibilidad, carnet_conducir_validado) VALUES ($1, $2, TRUE, FALSE, TRUE)", [perfilId, usuarioId]);
    const choferes = new RepositorioChoferesPostgres(pool);
    const ubicaciones = new RepositorioUbicacionesPostgres(pool, () => "00000000-0000-0000-0000-000000000023");
    const chofer = await choferes.obtenerPorUsuario(usuarioId);
    assert.equal(chofer?.disponibilidad, false);
    await choferes.guardar({ ...chofer!, disponibilidad: true, fechaActualizacion: new Date() });
    assert.equal((await choferes.obtenerPorUsuario(usuarioId))?.disponibilidad, true);
    const nueva = await ubicaciones.guardarSiEsMasNueva({ id: "", usuarioId, latitud: -27.45, longitud: -58.98, actualizadoAt: new Date("2026-10-15T12:00:05Z") });
    const anterior = await ubicaciones.guardarSiEsMasNueva({ id: "", usuarioId, latitud: -27.46, longitud: -58.99, actualizadoAt: new Date("2026-10-15T12:00:01Z") });
    assert.equal(nueva.latitud, anterior.latitud);
  } finally {
    await pool.query("DELETE FROM ubicacion_actual WHERE usuario_id = $1; DELETE FROM usuario_chofer WHERE usuario_id = $1", [usuarioId]);
    await pool.end();
  }
});
