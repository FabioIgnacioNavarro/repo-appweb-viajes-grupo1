import test from "node:test";
import { strict as assert } from "node:assert";
import type { Pool } from "pg";
import {
  crearPoolTarifas,
  RepositorioEstimacionesPostgres,
  RepositorioReglasPostgres,
  RepositorioZonasPostgres
} from "../../src/ms-tarifas/postgres";
import type { EstimacionTarifa } from "../../src/ms-tarifas/dominio";

test("RepositorioReglasPostgres mapea importes BIGINT a bigint nativo y lanza REGLA_NO_CONFIGURADA si no hay regla activa", async () => {
  const poolConFila = {
    async query() {
      return {
        rows: [
          {
            version: 2,
            tarifa_base_pesos: "1000",
            precio_por_kilometro_pesos: "600",
            precio_por_minuto_pesos: "120",
            multiplicador_minimo_escalado: 7500,
            multiplicador_maximo_escalado: 20000,
            factores: {
              lluvia_con_precipitacion_escalado: 11000,
              lluvia_sin_precipitacion_escalado: 10000,
              disponibilidad: [{ hasta: 0, multiplicadorEscalado: 13000 }],
              demanda_por_mil: [{ hasta: 999, multiplicadorEscalado: 10000 }],
              horario: { MADRUGADA: 10000, MANANA: 10000, SIESTA: 9500, TARDE: 10500, NOCHE: 11000 }
            }
          }
        ]
      };
    }
  } as unknown as Pool;

  const repo = new RepositorioReglasPostgres(poolConFila);
  const regla = await repo.obtenerActiva();
  assert.equal(regla.version, 2);
  assert.equal(regla.tarifaBasePesos, 1000n);
  assert.equal(regla.precioPorKilometroPesos, 600n);
  assert.equal(regla.precioPorMinutoPesos, 120n);
  assert.equal(regla.lluviaConPrecipitacionEscalado, 11000);

  const poolVacio = { async query() { return { rows: [] }; } } as unknown as Pool;
  await assert.rejects(
    () => new RepositorioReglasPostgres(poolVacio).obtenerActiva(),
    (err: { codigo?: string }) => err.codigo === "REGLA_NO_ENCONTRADA" || err.codigo === "REGLA_NO_CONFIGURADA"
  );
});

test("RepositorioZonasPostgres resuelve zona tarifaria activa y lanza ZONA_NO_ENCONTRADA fuera de cobertura", async () => {
  const poolZona = {
    async query() {
      return {
        rows: [
          {
            id: "resistencia",
            nombre: "Resistencia",
            latitud_centro: "-27.450000",
            longitud_centro: "-58.980000",
            radio_metros: 15000,
            zona_horaria: "America/Argentina/Buenos_Aires"
          }
        ]
      };
    }
  } as unknown as Pool;

  const zona = await new RepositorioZonasPostgres(poolZona).resolver({ latitud: -27.45, longitud: -58.98 });
  assert.equal(zona.id, "resistencia");
  assert.equal(zona.centro.latitud, -27.45);
  assert.equal(zona.radioMetros, 15000);

  const poolVacio = { async query() { return { rows: [] }; } } as unknown as Pool;
  await assert.rejects(
    () => new RepositorioZonasPostgres(poolVacio).resolver({ latitud: 0, longitud: 0 }),
    (err: { codigo?: string }) => err.codigo === "ZONA_NO_ENCONTRADA"
  );
});

test("RepositorioEstimacionesPostgres guarda y recupera estimaciones con BIGINT y snapshot JSONB", async () => {
  const parametrosGuardados: unknown[][] = [];
  const ahora = new Date("2026-10-15T12:00:00Z");
  const vigencia = new Date("2026-10-15T12:03:00Z");

  const poolMock = {
    async query(sql: string, params: unknown[]) {
      if (sql.startsWith("INSERT")) {
        parametrosGuardados.push(params);
        return { rows: [] };
      }
      if (params[0] === "no-existe") return { rows: [] };
      return {
        rows: [
          {
            id: "est-pg-1",
            pasajero_id: "pasajero-1",
            origen_latitud: "-27.450000",
            origen_longitud: "-58.980000",
            destino_latitud: "-27.460000",
            destino_longitud: "-58.990000",
            zona_id: "resistencia",
            zona_nombre: "Resistencia",
            zona_latitud_centro: "-27.450000",
            zona_longitud_centro: "-58.980000",
            zona_radio_metros: 15000,
            zona_horaria: "America/Argentina/Buenos_Aires",
            precio_estimado: "3700",
            distancia_metros: 2000,
            duracion_segundos: 240,
            proveedor_ruta: "OSRM",
            polilinea: "poly_pg",
            multiplicador_demanda_escalado: 12000,
            factores_precio: {
              choferesDisponibles: 4,
              solicitudesActivas: 2,
              precipitacionMm: 1.5,
              llueve: true,
              fuenteClima: "OPEN_METEO",
              climaObservadoEn: ahora.toISOString(),
              franjaHoraria: "MANANA",
              factorLluviaEscalado: 11000,
              factorDisponibilidadEscalado: 11000,
              factorDemandaEscalado: 10000,
              factorHorarioEscalado: 10000,
              multiplicadorAplicadoEscalado: 12000
            },
            version_regla: 1,
            creada_en: ahora,
            vigente_hasta: vigencia
          }
        ]
      };
    }
  } as unknown as Pool;

  const repo = new RepositorioEstimacionesPostgres(poolMock);
  const estimacion: EstimacionTarifa = {
    id: "est-pg-1",
    pasajeroId: "pasajero-1",
    origen: { latitud: -27.45, longitud: -58.98 },
    destino: { latitud: -27.46, longitud: -58.99 },
    zona: {
      id: "resistencia",
      nombre: "Resistencia",
      centro: { latitud: -27.45, longitud: -58.98 },
      radioMetros: 15000,
      zonaHoraria: "America/Argentina/Buenos_Aires"
    },
    precioEstimado: 3700n,
    moneda: "ARS",
    distanciaMetros: 2000,
    duracionSegundos: 240,
    proveedorRuta: "OSRM",
    polilinea: "poly_pg",
    multiplicadorDemandaEscalado: 12000,
    factoresPrecio: {
      choferesDisponibles: 4,
      solicitudesActivas: 2,
      precipitacionMm: 1.5,
      llueve: true,
      fuenteClima: "OPEN_METEO",
      climaObservadoEn: ahora,
      franjaHoraria: "MANANA",
      factorLluviaEscalado: 11000,
      factorDisponibilidadEscalado: 11000,
      factorDemandaEscalado: 10000,
      factorHorarioEscalado: 10000,
      multiplicadorAplicadoEscalado: 12000
    },
    versionRegla: 1,
    creadaEn: ahora,
    vigenteHasta: vigencia
  };

  await repo.guardar(estimacion);
  assert.equal(parametrosGuardados.length, 1);
  assert.equal(parametrosGuardados[0]?.[7], "3700");

  const recuperada = await repo.obtener("est-pg-1");
  assert.ok(recuperada);
  assert.equal(recuperada.precioEstimado, 3700n);
  assert.equal(recuperada.factoresPrecio.climaObservadoEn.toISOString(), ahora.toISOString());

  assert.equal(await repo.obtener("no-existe"), undefined);
});

test("crearPoolTarifas valida DATABASE_URL y DATABASE_POOL_MAX", () => {
  assert.throws(() => crearPoolTarifas({}), /DATABASE_URL es obligatoria/);
  assert.throws(
    () => crearPoolTarifas({ DATABASE_URL: "postgres://localhost:5432/db", DATABASE_POOL_MAX: "0" }),
    /DATABASE_POOL_MAX debe ser un entero/
  );
});
