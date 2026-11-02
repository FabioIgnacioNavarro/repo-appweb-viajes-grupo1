import assert from "node:assert/strict";
import test from "node:test";
import { iniciarMedicionProcesoFlota } from "./mediciones";

test("la medición de proceso queda apagada por defecto", () => {
  let registros = 0;
  const detener = iniciarMedicionProcesoFlota({ entorno: {}, registrar: () => { registros += 1; } });
  detener();
  assert.equal(registros, 0);
});

test("la medición valida su configuración sin iniciar un temporizador", () => {
  assert.throws(
    () => iniciarMedicionProcesoFlota({ entorno: { MEDICIONES_HABILITADAS: "si" } }),
    /MEDICIONES_HABILITADAS debe ser true o false/
  );
  assert.throws(
    () => iniciarMedicionProcesoFlota({ entorno: { MEDICIONES_HABILITADAS: "true", MEDICIONES_INTERVALO_MS: "99" } }),
    /MEDICIONES_INTERVALO_MS debe ser un entero/
  );
});
