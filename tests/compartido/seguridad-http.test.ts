import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { crearAplicacionEmulador } from "../../src/emulador-auth/servidor";
import { crearRouterTarifas } from "../../src/ms-tarifas/http";
import { RepositorioEstimacionesMemoria } from "../../src/ms-tarifas/dominio";

async function levantar(app: express.Express): Promise<{ base: string; cerrar: () => Promise<void> }> {
  const servidor: Server = createServer(app);
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const dir = servidor.address();
  if (!dir || typeof dir === "string") throw new Error("Puerto inválido");
  return {
    base: `http://127.0.0.1:${dir.port}`,
    cerrar: () => new Promise<void>((res, rej) => servidor.close((err) => (err ? rej(err) : res())))
  };
}

test("SEG-003: emulador-auth y ms-tarifas rechazan payloads mayores a 10KB (413) y JSON malformado (400) en formato uniforme", async () => {
  const emulador = await levantar(crearAplicacionEmulador());
  const appTarifas = express();
  appTarifas.use(
    crearRouterTarifas({
      estimar: async () => { throw new Error("no usar"); },
      estimaciones: new RepositorioEstimacionesMemoria(),
      validador: { async validar() { return { idUsuario: "p-1", rol: "PASAJERO" }; } },
      comprobarBase: async () => undefined
    })
  );
  const tarifas = await levantar(appTarifas);

  try {
    const cuerpoGrande = JSON.stringify({ id_usuario: "x".repeat(12 * 1024), rol: "pasajero" });

    // 1. Payload sobredimensionado en auth-emulator -> 413 PAYLOAD_DEMASIADO_GRANDE
    const resAuthGrande = await fetch(`${emulador.base}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cuerpoGrande
    });
    assert.equal(resAuthGrande.status, 413);
    const bodyAuthGrande = await resAuthGrande.json() as { error: { codigo: string } };
    assert.equal(bodyAuthGrande.error.codigo, "PAYLOAD_DEMASIADO_GRANDE");

    // 2. JSON malformado en auth-emulator -> 400 ENTRADA_INVALIDA (sin HTML stack trace)
    const resAuthRoto = await fetch(`${emulador.base}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{\"rol\": "
    });
    assert.equal(resAuthRoto.status, 400);
    const bodyAuthRoto = await resAuthRoto.json() as { error: { codigo: string } };
    assert.equal(bodyAuthRoto.error.codigo, "ENTRADA_INVALIDA");

    // 3. Payload sobredimensionado en ms-tarifas -> 413 PAYLOAD_DEMASIADO_GRANDE
    const resTarifaGrande = await fetch(`${tarifas.base}/viajes/estimacion`, {
      method: "POST",
      headers: { Authorization: "Bearer ok", "Content-Type": "application/json" },
      body: cuerpoGrande
    });
    assert.equal(resTarifaGrande.status, 413);
    const bodyTarifaGrande = await resTarifaGrande.json() as { error: { codigo: string } };
    assert.equal(bodyTarifaGrande.error.codigo, "PAYLOAD_DEMASIADO_GRANDE");

    // 4. JSON malformado en ms-tarifas -> 400 ENTRADA_INVALIDA
    const resTarifaRoto = await fetch(`${tarifas.base}/viajes/estimacion`, {
      method: "POST",
      headers: { Authorization: "Bearer ok", "Content-Type": "application/json" },
      body: "{invalido"
    });
    assert.equal(resTarifaRoto.status, 400);
    const bodyTarifaRoto = await resTarifaRoto.json() as { error: { codigo: string } };
    assert.equal(bodyTarifaRoto.error.codigo, "ENTRADA_INVALIDA");
  } finally {
    await emulador.cerrar();
    await tarifas.cerrar();
  }
});
