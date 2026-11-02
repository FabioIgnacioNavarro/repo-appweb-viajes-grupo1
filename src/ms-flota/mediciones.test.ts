import assert from "node:assert/strict";
import test from "node:test";
import { convertirMemoriaProcesoMiB, iniciarMedicionProcesoFlota } from "./mediciones";

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

test("separa RSS, heap, memoria externa y buffers de ArrayBuffer en MiB", () => {
  const mebibytes = 1024 * 1024;
  const memoria = convertirMemoriaProcesoMiB({
    rss: 120 * mebibytes,
    heapTotal: 40 * mebibytes,
    heapUsed: 25 * mebibytes,
    external: 8 * mebibytes,
    arrayBuffers: 3 * mebibytes
  });

  assert.deepEqual(memoria, {
    memoria_rss_mib: 120,
    memoria_heap_usado_mib: 25,
    memoria_externa_mib: 8,
    memoria_array_buffers_mib: 3
  });
});
