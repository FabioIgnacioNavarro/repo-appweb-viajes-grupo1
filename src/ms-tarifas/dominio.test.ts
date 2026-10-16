import { strict as assert } from "node:assert";
import test from "node:test";
import {
  calcularPrecioPesos, CrearEstimacion, GeneradorIdMemoria, RepositorioEstimacionesMemoria,
  type CalculadorRuta, type FuenteClima, type FuenteDemanda, type FuenteDisponibilidad,
  type ObservacionClima, type ReglaTarifa, type RepositorioReglas, type RepositorioZonas,
  type RutaCalculada, type ZonaTarifaria
} from "./dominio";
import { FuenteDemandaHttp, FuenteFlotaHttp, RutaHaversine, RutaOsrm } from "./proveedores";

const zona: ZonaTarifaria = { id: "resistencia", nombre: "Resistencia", centro: { latitud: -27.45, longitud: -58.98 }, radioMetros: 15_000, zonaHoraria: "America/Argentina/Buenos_Aires" };
const regla: ReglaTarifa = {
  version: 3, tarifaBasePesos: 1000n, precioPorKilometroPesos: 600n, precioPorMinutoPesos: 120n,
  multiplicadorMinimoEscalado: 7500, multiplicadorMaximoEscalado: 20_000,
  lluviaConPrecipitacionEscalado: 11_000, lluviaSinPrecipitacionEscalado: 10_000,
  disponibilidad: [{ hasta: 0, multiplicadorEscalado: 13_000 }, { hasta: 2, multiplicadorEscalado: 12_000 }, { hasta: 5, multiplicadorEscalado: 11_000 }, { hasta: 11, multiplicadorEscalado: 10_000 }, { hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 9000 }],
  demandaPorMil: [{ hasta: 999, multiplicadorEscalado: 10_000 }, { hasta: 1999, multiplicadorEscalado: 11_000 }, { hasta: 2999, multiplicadorEscalado: 12_000 }, { hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 13_000 }],
  horario: { MADRUGADA: 10_000, MANANA: 10_000, SIESTA: 9500, TARDE: 10_500, NOCHE: 11_000 }
};

function estimador(datos: { ruta?: RutaCalculada; lluvia?: number; choferes?: number; solicitudes?: number; reglaUsada?: ReglaTarifa; observadaEn?: string } = {}) {
  const clima: ObservacionClima = { precipitacionMm: datos.lluvia ?? 0, observadaEn: new Date(datos.observadaEn ?? "2026-10-15T22:55:00Z"), fuente: "CLIMA_FALSO" };
  const rutas: CalculadorRuta = { async calcular() { return datos.ruta ?? { distanciaMetros: 1000, duracionSegundos: 180, proveedor: "OSRM" }; } };
  const fuenteClima: FuenteClima = { async consultar() { return clima; } };
  const disponibilidad: FuenteDisponibilidad = { async contarDisponibles() { return datos.choferes ?? 10; } };
  const demanda: FuenteDemanda = { async contarSolicitudesActivas() { return datos.solicitudes ?? 2; } };
  const zonas: RepositorioZonas = { async resolver() { return zona; } };
  const reglas: RepositorioReglas = { async obtenerActiva() { return datos.reglaUsada ?? regla; } };
  const repositorio = new RepositorioEstimacionesMemoria();
  return { caso: new CrearEstimacion(rutas, fuenteClima, disponibilidad, demanda, zonas, reglas, repositorio, new GeneradorIdMemoria()), repositorio };
}

test("calcula la tarifa base usando distancia, duración y pesos enteros", () => {
  assert.equal(calcularPrecioPesos({ distanciaMetros: 1000, duracionSegundos: 180 }, regla, 10_000), 1960n);
});

test("calcula y audita lluvia, disponibilidad, demanda y franja horaria", async () => {
  const contexto = estimador({ lluvia: 2.5, choferes: 1, solicitudes: 3 });
  const estimacion = await contexto.caso.ejecutar("pasajero-1", zona.centro, { latitud: -27.46, longitud: -58.99 }, new Date("2026-10-15T23:00:00Z"));
  assert.equal(estimacion.multiplicadorDemandaEscalado, 18_876);
  assert.equal(estimacion.precioEstimado, 3700n);
  assert.equal(estimacion.factoresPrecio.llueve, true);
  assert.equal(estimacion.factoresPrecio.factorDisponibilidadEscalado, 12_000);
  assert.equal(estimacion.factoresPrecio.factorDemandaEscalado, 13_000);
  assert.equal(estimacion.factoresPrecio.franjaHoraria, "NOCHE");
  assert.deepEqual(await contexto.repositorio.obtener(estimacion.id), estimacion);
});

test("limita el multiplicador máximo y el precio se mantiene en BigInt", async () => {
  const reglaAcotada = { ...regla, multiplicadorMaximoEscalado: 12_000, lluviaConPrecipitacionEscalado: 20_000, disponibilidad: [{ hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 20_000 }], demandaPorMil: [{ hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 20_000 }], horario: { MADRUGADA: 20_000, MANANA: 20_000, SIESTA: 20_000, TARDE: 20_000, NOCHE: 20_000 } };
  const resultado = await estimador({ lluvia: 1, reglaUsada: reglaAcotada }).caso.ejecutar("pasajero-1", zona.centro, zona.centro, new Date("2026-10-15T23:00:00Z"));
  assert.equal(resultado.multiplicadorDemandaEscalado, 12_000);
  assert.equal(typeof resultado.precioEstimado, "bigint");
});

test("fija vigencia de tres minutos y conserva el multiplicador sin lluvia", async () => {
  const ahora = new Date("2026-10-15T12:30:00Z");
  const resultado = await estimador({ lluvia: 0, observadaEn: "2026-10-15T12:20:00Z" }).caso.ejecutar("pasajero-1", zona.centro, zona.centro, ahora);
  assert.equal(resultado.vigenteHasta.getTime() - ahora.getTime(), 180_000);
  assert.equal(resultado.factoresPrecio.factorLluviaEscalado, 10_000);
  assert.equal(resultado.factoresPrecio.franjaHoraria, "MANANA");
});

test("Haversine calcula distancia en modo offline sin llamar un proveedor", async () => {
  const ruta = await new RutaHaversine().calcular({ latitud: 0, longitud: 0 }, { latitud: 0, longitud: 1 });
  assert.equal(ruta.proveedor, "HAVERSINE");
  assert.ok(ruta.distanciaMetros > 111_000 && ruta.distanciaMetros < 112_000);
  assert.equal(ruta.duracionSegundos, Math.round(ruta.distanciaMetros / 1000 * 180));
});

test("OSRM usa geometría y distancia recibidas del servidor configurado", async () => {
  let url = "";
  const ruta = new RutaOsrm("http://osrm:5000", 1800, async (direccion) => {
    url = direccion;
    return new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 1234.7, duration: 91.2, geometry: "polyline" }] }), { status: 200 });
  }).calcular({ latitud: -27, longitud: -58 }, { latitud: -28, longitud: -59 });
  const resultado = await ruta;
  assert.equal(resultado.distanciaMetros, 1235);
  assert.equal(resultado.duracionSegundos, 91);
  assert.equal(resultado.polilinea, "polyline");
  assert.match(url, /route\/v1\/driving/);
});

test("ms-tarifas consulta candidatos de flota y demanda reenviando el JWT", async () => {
  const autorizaciones: string[] = [];
  const obtener = async (url: string, opciones?: RequestInit) => {
    autorizaciones.push(new Headers(opciones?.headers).get("Authorization") ?? "");
    if (url.includes("choferes/cercanos")) return Response.json({ candidatos: [{ id_chofer: "chofer-1" }, { id_chofer: "chofer-2" }] });
    return Response.json({ zona_id: "resistencia", solicitudes_activas: 7 });
  };
  const flota = await new FuenteFlotaHttp("http://ms-flota:3002", "jwt-original", 1500, obtener).contarDisponibles(zona, zona.centro);
  const demanda = await new FuenteDemandaHttp("http://ms-viajes:3000", "jwt-original", 1500, obtener).contarSolicitudesActivas(zona);
  assert.equal(flota, 2);
  assert.equal(demanda, 7);
  assert.deepEqual(autorizaciones, ["Bearer jwt-original", "Bearer jwt-original"]);
});
