import assert from "node:assert/strict";
import test from "node:test";
import {
  analizarArgumentos,
  calcularPercentil,
  convertirMemoriaMiB,
  crearGeneradorDeterminista,
  crearTokenFalso,
  crearUbicacionInicial,
  parsearPorcentaje
} from "./simulador.mjs";

test("el modo prueba usa valores cortos y seguros por defecto", () => {
  assert.deepEqual(analizarArgumentos(["--modo", "prueba"]), {
    ayuda: false,
    modo: "prueba",
    escenario: "carga",
    baseUrl: "http://localhost:8080",
    choferes: 5,
    calentamientoSegundos: 2,
    duracionSegundos: 12,
    recuperacionSegundos: 1,
    semilla: 42,
    concurrencia: 256,
    repeticion: 1
  });
});

test("rechaza destinos remotos y parámetros fuera de rango", () => {
  assert.throws(() => analizarArgumentos(["--base-url", "https://api.ejemplo.com"]), /solo admite HTTP en localhost/);
  assert.throws(() => analizarArgumentos(["--choferes", "501"]), /choferes debe ser un entero/);
  assert.throws(() => analizarArgumentos(["--escenario", "produccion"]), /escenario debe ser carga o reposo/);
});

test("las ubicaciones iniciales son reproducibles y quedan dentro del radio de prueba", () => {
  const primero = crearGeneradorDeterminista(42);
  const segundo = crearGeneradorDeterminista(42);
  const ubicacionA = crearUbicacionInicial(primero);
  const ubicacionB = crearUbicacionInicial(segundo);
  assert.deepEqual(ubicacionA, ubicacionB);
  assert.ok(Number.isFinite(ubicacionA.latitud));
  assert.ok(Number.isFinite(ubicacionA.longitud));
  assert.ok(ubicacionA.latitud < -27.40 && ubicacionA.latitud > -27.50);
});

test("calcula percentiles sin redondear hacia abajo", () => {
  assert.equal(calcularPercentil([], 99), null);
  assert.equal(calcularPercentil([30, 10, 20, 40], 50), 20);
  assert.equal(calcularPercentil([30, 10, 20, 40], 95), 40);
});

test("convierte memoria Docker a MiB", () => {
  assert.equal(convertirMemoriaMiB("1.5GiB / 8GiB"), 1536);
  assert.equal(convertirMemoriaMiB("512MiB / 8GiB"), 512);
  assert.equal(convertirMemoriaMiB("N/A"), null);
});

test("parsea CPU de Docker con punto o coma decimal e ignora valores vacíos", () => {
  assert.equal(parsearPorcentaje("1.34%"), 1.34);
  assert.equal(parsearPorcentaje("0,75%"), 0.75);
  assert.equal(parsearPorcentaje("N/A"), null);
  assert.equal(parsearPorcentaje(""), null);
});

test("genera un JWT falso compatible para cada actor de prueba", () => {
  const token = crearTokenFalso("chofer-prueba", "CHOFER");
  const cuerpo = JSON.parse(Buffer.from(token.slice("falso.".length), "base64url").toString("utf8"));
  assert.deepEqual(cuerpo, { tipo: "jwt-falso", idUsuario: "chofer-prueba", rol: "CHOFER" });
});
