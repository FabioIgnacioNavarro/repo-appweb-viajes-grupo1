import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

// Igual que en ms-flota: si no hay base configurada, el test se omite y `npm.cmd test` sigue en verde.
const disponible = Boolean(process.env.DATABASE_URL);
const PREFIJO = "test-schema-";

type Parametros = Record<string, unknown>;

async function insertarViaje(pool: Pool, id: string, extra: Parametros = {}): Promise<void> {
  const v = {
    pasajero: `${PREFIJO}pasajero`, chofer: null, estado: "SOLICITADO", precio: "8086",
    precioFinal: null, cancelado: null, ...extra
  };
  await pool.query(
    `INSERT INTO viajes.viaje (id, pasajero_usuario_id, chofer_usuario_id, estimacion_id, estado,
       origen_latitud, origen_longitud, destino_latitud, destino_longitud,
       precio_estimado, precio_final, multiplicador_demanda, factores_precio, creado_en, cancelado_en)
     VALUES ($1, $2, $3, $4, $5, -27.45, -58.98, -27.46, -58.99, $6, $7, 1.5, '{"zona_id":"centro"}', now(), $8)`,
    [`${PREFIJO}${id}`, v.pasajero, v.chofer, `${PREFIJO}estimacion-${id}`, v.estado, v.precio, v.precioFinal, v.cancelado]
  );
}

async function insertarOferta(pool: Pool, id: string, viaje: string, chofer: string, estado = "PENDIENTE"): Promise<void> {
  await pool.query(
    `INSERT INTO viajes.oferta (id, viaje_id, chofer_usuario_id, estado, enviada_en, expira_en)
     VALUES ($1, $2, $3, $4, now(), now() + interval '60 seconds')`,
    [`${PREFIJO}${id}`, `${PREFIJO}${viaje}`, `${PREFIJO}${chofer}`, estado]
  );
}

const codigo = (esperado: string) => (error: unknown) => (error as { code?: string }).code === esperado;

async function limpiar(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM viajes.cobro WHERE viaje_id LIKE $1", [`${PREFIJO}%`]);
  await pool.query("DELETE FROM viajes.oferta WHERE viaje_id LIKE $1", [`${PREFIJO}%`]);
  await pool.query("DELETE FROM viajes.viaje WHERE id LIKE $1", [`${PREFIJO}%`]);
  await pool.query("DELETE FROM viajes.idempotencia WHERE actor_id LIKE $1", [`${PREFIJO}%`]);
}

test("el esquema de ms-viajes hace cumplir las invariantes en PostgreSQL", { skip: !disponible }, async (t) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const sql = await readFile("src/ms-viajes/schema.sql", "utf8");
    await pool.query(sql);
    await pool.query(sql); // aplicarlo dos veces no debe fallar (idempotente)
    await limpiar(pool);

    await t.test("un chofer no puede tener dos viajes activos", async () => {
      await insertarViaje(pool, "a1", { chofer: `${PREFIJO}chofer-1`, estado: "ASIGNADO" });
      await assert.rejects(() => insertarViaje(pool, "a2", { chofer: `${PREFIJO}chofer-1`, estado: "EN_CURSO" }), codigo("23505"));
      await assert.rejects(() => insertarViaje(pool, "a3", { chofer: `${PREFIJO}chofer-1`, estado: "CHOFER_EN_CAMINO" }), codigo("23505"));
    });

    await t.test("el mismo chofer puede aceptar otro viaje cuando el anterior terminó", async () => {
      await pool.query("UPDATE viajes.viaje SET estado = 'FINALIZADO', precio_final = 8086 WHERE id = $1", [`${PREFIJO}a1`]);
      await insertarViaje(pool, "b1", { chofer: `${PREFIJO}chofer-1`, estado: "ASIGNADO" });
    });

    await t.test("viajes no activos no ocupan al chofer", async () => {
      const cancelado = new Date();
      await insertarViaje(pool, "c1", { chofer: `${PREFIJO}chofer-2`, estado: "CANCELADO_POR_CHOFER", cancelado });
      await insertarViaje(pool, "c2", { chofer: `${PREFIJO}chofer-2`, estado: "CANCELADO_POR_PASAJERO", cancelado });
      await insertarViaje(pool, "c3", { chofer: `${PREFIJO}chofer-2`, estado: "ASIGNADO" });
    });

    await t.test("un viaje asignado exige chofer y un precio final solo existe si está finalizado", async () => {
      await assert.rejects(() => insertarViaje(pool, "d1", { estado: "ASIGNADO" }), codigo("23514"));
      await assert.rejects(() => insertarViaje(pool, "d2", { estado: "SOLICITADO", precioFinal: "100" }), codigo("23514"));
      await assert.rejects(() => insertarViaje(pool, "d3", { estado: "CANCELADO_POR_PASAJERO" }), codigo("23514"));
      await assert.rejects(() => insertarViaje(pool, "d4", { estado: "INVENTADO" }), codigo("23514"));
    });

    await t.test("los importes son BIGINT exactos y no pierden precisión", async () => {
      const grande = "9007199254740993"; // 2^53 + 1: un number de JavaScript lo redondearía
      await insertarViaje(pool, "e1", { precio: grande });
      const { rows } = await pool.query<{ precio_estimado: string }>("SELECT precio_estimado FROM viajes.viaje WHERE id = $1", [`${PREFIJO}e1`]);
      assert.equal(rows[0]?.precio_estimado, grande);
      await assert.rejects(() => insertarViaje(pool, "e2", { precio: "-1" }), codigo("23514"));
    });

    await t.test("un chofer recibe una sola oferta por viaje y un viaje una sola aceptada", async () => {
      await insertarViaje(pool, "f1");
      await insertarOferta(pool, "o1", "f1", "chofer-a");
      await assert.rejects(() => insertarOferta(pool, "o2", "f1", "chofer-a"), codigo("23505"));
      await insertarOferta(pool, "o3", "f1", "chofer-b", "ACEPTADA");
      await assert.rejects(() => insertarOferta(pool, "o4", "f1", "chofer-c", "ACEPTADA"), codigo("23505"));
      await insertarOferta(pool, "o5", "f1", "chofer-d", "NO_SELECCIONADA");
    });

    await t.test("una oferta no puede apuntar a un viaje inexistente", async () => {
      await assert.rejects(() => insertarOferta(pool, "o6", "no-existe", "chofer-a"), codigo("23503"));
    });

    await t.test("un viaje se cobra una sola vez", async () => {
      await insertarViaje(pool, "g1", { chofer: `${PREFIJO}chofer-9`, estado: "FINALIZADO", precioFinal: "8086" });
      const cobrar = (id: string) => pool.query(
        "INSERT INTO viajes.cobro (id, viaje_id, importe, estado, creado_en) VALUES ($1, $2, 8086, 'CONFIRMADO', now())",
        [`${PREFIJO}${id}`, `${PREFIJO}g1`]
      );
      await cobrar("cobro-1");
      await assert.rejects(() => cobrar("cobro-2"), codigo("23505"));
    });

    await t.test("la misma clave de idempotencia no se registra dos veces", async () => {
      const registrar = (actor: string, operacion: string, clave: string) => pool.query(
        "INSERT INTO viajes.idempotencia (actor_id, operacion, clave, huella_solicitud, resultado) VALUES ($1, $2, $3, 'huella', '{}')",
        [`${PREFIJO}${actor}`, operacion, clave]
      );
      await registrar("p1", "confirmar-viaje", "clave-1");
      await assert.rejects(() => registrar("p1", "confirmar-viaje", "clave-1"), codigo("23505"));
      await registrar("p2", "confirmar-viaje", "clave-1"); // otro actor puede usar la misma clave
      await registrar("p1", "otra-operacion", "clave-1"); // otra intención del mismo actor también
    });
  } finally {
    await limpiar(pool);
    await pool.end();
  }
});
