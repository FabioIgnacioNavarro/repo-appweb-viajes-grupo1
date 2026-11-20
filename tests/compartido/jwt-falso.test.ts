import assert from "node:assert/strict";
import test from "node:test";
import { ValidadorJwtJwks } from "../../src/compartido/jwt";
import { crearValidadorJwtDesdeEntorno, ValidadorJwtFalso } from "../../src/compartido/jwt-falso";

test("JWT falso válido representa un actor de prueba", async () => {
  const validador = new ValidadorJwtFalso();
  const token = validador.generar({ idUsuario: "chofer-1", rol: "CHOFER" });
  assert.deepEqual(await validador.validar(token), { idUsuario: "chofer-1", rol: "CHOFER" });
});

test("JWT falso inválido es rechazado", async () => {
  await assert.rejects(() => new ValidadorJwtFalso().validar("falso.no-es-json"));
  await assert.rejects(() => new ValidadorJwtFalso().validar("falso."));
});

test("ARC-006: JWT_MODO=falso está estrictamente bloqueado cuando NODE_ENV=production", async () => {
  const nodeEnvAnterior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const validador = new ValidadorJwtFalso();
    const token = validador.generar({ idUsuario: "pasajero-1", rol: "PASAJERO" });
    await assert.rejects(() => validador.validar(token), /producción/);

    assert.throws(
      () => crearValidadorJwtDesdeEntorno({ NODE_ENV: "production", JWT_MODO: "falso" }),
      /JWT_MODO=falso no está permitido en producción/
    );

    const real = crearValidadorJwtDesdeEntorno({
      NODE_ENV: "production",
      JWT_MODO: "real",
      JWT_JWKS_URL: "http://auth-emulator:9099/.well-known/jwks.json",
      JWT_ISSUER: "http://auth-emulator:9099/demo-viajes-grupo1",
      JWT_AUDIENCE: "demo-viajes-grupo1"
    });
    assert.ok(real instanceof ValidadorJwtJwks);
  } finally {
    if (nodeEnvAnterior === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = nodeEnvAnterior;
    }
  }
});
