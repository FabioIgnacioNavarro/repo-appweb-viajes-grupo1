import { strict as assert } from "node:assert";
import test from "node:test";
import {
  ErrorTarifas,
  CrearEstimacion,
  GeneradorIdMemoria,
  RepositorioEstimacionesMemoria,
  type CalculadorRuta,
  type FuenteClima,
  type FuenteDemanda,
  type FuenteDisponibilidad,
  type ObservacionClima,
  type ReglaTarifa,
  type RepositorioReglas,
  type RepositorioZonas,
  type ZonaTarifaria
} from "./dominio";
import {
  GeocodificadorFalso,
  GeocodificadorGoogle,
  crearGeocodificador,
  RutaGoogle
} from "./proveedores";

const zona: ZonaTarifaria = {
  id: "resistencia",
  nombre: "Resistencia",
  centro: { latitud: -27.45, longitud: -58.98 },
  radioMetros: 15_000,
  zonaHoraria: "America/Argentina/Buenos_Aires"
};

const regla: ReglaTarifa = {
  version: 1,
  tarifaBasePesos: 1000n,
  precioPorKilometroPesos: 600n,
  precioPorMinutoPesos: 120n,
  multiplicadorMinimoEscalado: 8000,
  multiplicadorMaximoEscalado: 20_000,
  lluviaConPrecipitacionEscalado: 11_000,
  lluviaSinPrecipitacionEscalado: 10_000,
  disponibilidad: [{ hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 10_000 }],
  demandaPorMil: [{ hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 10_000 }],
  horario: { MADRUGADA: 10_000, MANANA: 10_000, SIESTA: 10_000, TARDE: 10_000, NOCHE: 10_000 }
};

test("GeocodificadorFalso resuelve semillas conocidas y pares de coordenadas", async () => {
  const geocodificador = new GeocodificadorFalso();

  const plaza = await geocodificador.geocodificar("Plaza 25 de Mayo, Resistencia");
  assert.equal(plaza.latitud, -27.451);
  assert.equal(plaza.longitud, -58.986);

  const terminal = await geocodificador.geocodificar("terminal");
  assert.equal(terminal.latitud, -27.462);
  assert.equal(terminal.longitud, -58.993);

  const manual = await geocodificador.geocodificar("-27.500, -59.000");
  assert.equal(manual.latitud, -27.5);
  assert.equal(manual.longitud, -59);
});

test("GeocodificadorFalso rechaza entradas vacías o desconocidas", async () => {
  const geocodificador = new GeocodificadorFalso();

  await assert.rejects(
    () => geocodificador.geocodificar("   "),
    (err: ErrorTarifas) => err.codigo === "DIRECCION_INVALIDA"
  );

  await assert.rejects(
    () => geocodificador.geocodificar("calle completamente inexistente 12345"),
    (err: ErrorTarifas) => err.codigo === "DIRECCION_NO_ENCONTRADA"
  );
});

test("GeocodificadorGoogle resuelve dirección exitosamente con respuesta de Google", async () => {
  let urlLlamada = "";
  const obtenerMock = async (url: string) => {
    urlLlamada = url;
    return new Response(
      JSON.stringify({
        status: "OK",
        results: [
          {
            geometry: {
              location: { lat: -27.4511, lng: -58.9866 }
            }
          }
        ]
      }),
      { status: 200 }
    );
  };

  const geocodificador = new GeocodificadorGoogle("clave-api-falsa", 1000, obtenerMock as typeof fetch);
  const coord = await geocodificador.geocodificar("Plaza 25 de Mayo");

  assert.equal(coord.latitud, -27.4511);
  assert.equal(coord.longitud, -58.9866);
  assert.match(urlLlamada, /maps\.googleapis\.com\/maps\/api\/geocode\/json/);
  assert.match(urlLlamada, /key=clave-api-falsa/);
  assert.match(urlLlamada, /address=Plaza\+25\+de\+Mayo/);
});

test("GeocodificadorGoogle traduce ZERO_RESULTS a DIRECCION_NO_ENCONTRADA", async () => {
  const obtenerMock = async () =>
    new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), { status: 200 });

  const geocodificador = new GeocodificadorGoogle("clave-api-falsa", 1000, obtenerMock as typeof fetch);

  await assert.rejects(
    () => geocodificador.geocodificar("lugar-fantasma"),
    (err: ErrorTarifas) => err.codigo === "DIRECCION_NO_ENCONTRADA"
  );
});

test("GeocodificadorGoogle falla de forma segura ante error 500 del proveedor", async () => {
  const obtenerMock = async () =>
    new Response("Internal Server Error", { status: 500 });

  const geocodificador = new GeocodificadorGoogle("clave-api-falsa", 1000, obtenerMock as typeof fetch);

  await assert.rejects(
    () => geocodificador.geocodificar("cualquier lugar"),
    (err: ErrorTarifas) => err.codigo === "DEPENDENCIA_NO_DISPONIBLE"
  );
});

test("RutaGoogle formatea la consulta y procesa la respuesta de Google Routes API", async () => {
  let headersEnviados: Headers | undefined;
  let bodyEnviado = "";
  const obtenerMock = async (_url: string, init?: RequestInit) => {
    headersEnviados = new Headers(init?.headers);
    bodyEnviado = String(init?.body);
    return new Response(
      JSON.stringify({
        routes: [
          {
            distanceMeters: 4500,
            duration: "600s",
            polyline: { encodedPolyline: "polilinea_de_prueba" }
          }
        ]
      }),
      { status: 200 }
    );
  };

  const calculador = new RutaGoogle("clave-api-falsa", 1000, obtenerMock as typeof fetch);
  const ruta = await calculador.calcular(
    { latitud: -27.45, longitud: -58.98 },
    { latitud: -27.46, longitud: -58.99 }
  );

  assert.equal(ruta.proveedor, "GOOGLE");
  assert.equal(ruta.distanciaMetros, 4500);
  assert.equal(ruta.duracionSegundos, 600);
  assert.equal(ruta.polilinea, "polilinea_de_prueba");
  assert.equal(headersEnviados?.get("X-Goog-Api-Key"), "clave-api-falsa");
  assert.match(bodyEnviado, /TRAFFIC_AWARE/);
});

test("crearGeocodificador devuelve adaptador falso por defecto o con HAVERSINE", () => {
  const geoHaversine = crearGeocodificador({ RUTA_PROVEEDOR: "HAVERSINE" });
  assert.ok(geoHaversine instanceof GeocodificadorFalso);

  const geoFalso = crearGeocodificador({ PROVEEDORES_MODO: "falso", RUTA_PROVEEDOR: "GOOGLE", GOOGLE_MAPS_API_KEY: "abc" });
  assert.ok(geoFalso instanceof GeocodificadorFalso);

  const geoGoogle = crearGeocodificador({ RUTA_PROVEEDOR: "GOOGLE", GOOGLE_MAPS_API_KEY: "clave-google" });
  assert.ok(geoGoogle instanceof GeocodificadorGoogle);
});

test("CrearEstimacion resuelve direcciones textuales usando el geocodificador provisto", async () => {
  const clima: ObservacionClima = { precipitacionMm: 0, observadaEn: new Date(), fuente: "FAKE" };
  const rutas: CalculadorRuta = { async calcular() { return { distanciaMetros: 2000, duracionSegundos: 300, proveedor: "HAVERSINE" }; } };
  const fuenteClima: FuenteClima = { async consultar() { return clima; } };
  const disponibilidad: FuenteDisponibilidad = { async contarDisponibles() { return 5; } };
  const demanda: FuenteDemanda = { async contarSolicitudesActivas() { return 1; } };
  const zonas: RepositorioZonas = { async resolver() { return zona; } };
  const reglas: RepositorioReglas = { async obtenerActiva() { return regla; } };
  const repositorio = new RepositorioEstimacionesMemoria();
  const geocodificador = new GeocodificadorFalso();

  const caso = new CrearEstimacion(
    rutas,
    fuenteClima,
    disponibilidad,
    demanda,
    zonas,
    reglas,
    repositorio,
    new GeneradorIdMemoria(),
    geocodificador
  );

  const estimacion = await caso.ejecutar(
    "pasajero-1",
    { direccion: "Plaza 25 de Mayo, Resistencia" },
    { direccion: "Aeropuerto Resistencia" }
  );

  assert.equal(estimacion.origen.latitud, -27.451);
  assert.equal(estimacion.origen.longitud, -58.986);
  assert.equal(estimacion.destino.latitud, -27.448);
  assert.equal(estimacion.destino.longitud, -59.056);
  assert.ok(estimacion.precioEstimado > 0n);
});

test("CrearEstimacion falla si se pasan direcciones pero no hay geocodificador configurado", async () => {
  const clima: ObservacionClima = { precipitacionMm: 0, observadaEn: new Date(), fuente: "FAKE" };
  const rutas: CalculadorRuta = { async calcular() { return { distanciaMetros: 1000, duracionSegundos: 120, proveedor: "HAVERSINE" }; } };
  const caso = new CrearEstimacion(
    rutas,
    { async consultar() { return clima; } },
    { async contarDisponibles() { return 5; } },
    { async contarSolicitudesActivas() { return 1; } },
    { async resolver() { return zona; } },
    { async obtenerActiva() { return regla; } },
    new RepositorioEstimacionesMemoria(),
    new GeneradorIdMemoria()
  );

  await assert.rejects(
    () => caso.ejecutar("pasajero-1", { direccion: "Plaza 25 de Mayo" }, { latitud: -27.46, longitud: -58.99 }),
    (err: ErrorTarifas) => err.codigo === "GEOCODIFICADOR_NO_CONFIGURADO"
  );
});
