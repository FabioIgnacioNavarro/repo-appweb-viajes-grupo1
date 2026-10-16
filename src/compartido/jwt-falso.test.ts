import assert from "node:assert/strict";
import test from "node:test";
import { ValidadorJwtFalso } from "./jwt-falso";

test("JWT falso válido representa un actor de prueba", async () => {
  const validador = new ValidadorJwtFalso();
  const token = validador.generar({ idUsuario: "chofer-1", rol: "CHOFER" });
  assert.deepEqual(await validador.validar(token), { idUsuario: "chofer-1", rol: "CHOFER" });
});

test("JWT falso inválido es rechazado", async () => {
  await assert.rejects(() => new ValidadorJwtFalso().validar("falso.no-es-json"));
  await assert.rejects(() => new ValidadorJwtFalso().validar("falso."));
});
