import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";
import {
  coordenadasResistencia,
  emitirTokenPrueba,
  latenciaHealthMs,
  obtenerBaseUrl,
  registrarMetricasHttp,
} from "./comun.js";

const latenciaEstimacionOk = new Trend("latencia_estimacion_ok_ms", true);
const latenciaConfirmacionOk = new Trend("latencia_confirmacion_ok_ms", true);
const latenciaUbicacionOk = new Trend("latencia_ubicacion_ok_ms", true);
const latenciaBusquedaOk = new Trend("latencia_busqueda_ok_ms", true);

const esSmoke = (__ENV.K6_MODO || "stress").toLowerCase() === "smoke";

export const options = {
  scenarios: esSmoke
    ? {
        viajes_smoke: {
          executor: "constant-vus",
          exec: "flujoViajes",
          vus: 2,
          duration: "10s",
        },
        flota_smoke: {
          executor: "constant-arrival-rate",
          exec: "rafagaFlota",
          rate: 8,
          timeUnit: "1s",
          duration: "10s",
          preAllocatedVUs: 4,
          maxVUs: 10,
        },
        sondas_salud: {
          executor: "constant-arrival-rate",
          exec: "sondaSalud",
          rate: 2,
          timeUnit: "1s",
          duration: "10s",
          preAllocatedVUs: 2,
          maxVUs: 4,
        },
      }
    : {
        viajes_stress: {
          executor: "ramping-vus",
          exec: "flujoViajes",
          startVUs: 1,
          stages: [
            { duration: "10s", target: 4 },
            { duration: "15s", target: 12 },
            { duration: "15s", target: 22 },
            { duration: "5s", target: 0 },
          ],
        },
        flota_rafagas: {
          executor: "ramping-arrival-rate",
          exec: "rafagaFlota",
          startRate: 5,
          timeUnit: "1s",
          preAllocatedVUs: 10,
          maxVUs: 40,
          stages: [
            { duration: "10s", target: 15 }, // dentro del rate nominal Nginx
            { duration: "15s", target: 35 }, // borde/pico de rate limit 30r/s
            { duration: "15s", target: 50 }, // stress sostenido combinando servicios
            { duration: "5s", target: 0 },
          ],
        },
        sondas_salud: {
          executor: "constant-arrival-rate",
          exec: "sondaSalud",
          rate: 2,
          timeUnit: "1s",
          duration: "45s",
          preAllocatedVUs: 2,
          maxVUs: 6,
        },
      },
  thresholds: {
    errores_5xx: ["rate<0.01"],
    latencia_health_ms: ["p(95)<150"],
    latencia_estimacion_ok_ms: ["p(95)<500", "p(99)<1000"],
    latencia_confirmacion_ok_ms: ["p(95)<1500", "p(99)<3000"],
    latencia_ubicacion_ok_ms: ["p(95)<300", "p(99)<600"],
    latencia_busqueda_ok_ms: ["p(95)<300", "p(99)<600"],
    checks: ["rate>0.99"],
  },
};

export function setup() {
  const baseUrl = obtenerBaseUrl();
  const tokenPasajero = emitirTokenPrueba(
    baseUrl,
    "22222222-2222-4222-8222-222222222222",
    "pasajero",
    "Pasajero Stress k6"
  );
  const tokenChofer = emitirTokenPrueba(
    baseUrl,
    "11111111-1111-4111-8111-111111111111",
    "chofer",
    "Chofer Stress k6"
  );

  http.patch(
    `${baseUrl}/choferes/yo/disponibilidad`,
    JSON.stringify({ disponibilidad: true }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenChofer}`,
      },
    }
  );

  return { baseUrl, tokenPasajero, tokenChofer };
}

export function flujoViajes(data) {
  const coords = coordenadasResistencia(__VU * 100 + __ITER);
  const resEst = http.post(
    `${data.baseUrl}/viajes/estimacion`,
    JSON.stringify(coords),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.tokenPasajero}`,
      },
      tags: { escenario: "viajes", endpoint: "estimacion" },
    }
  );
  registrarMetricasHttp(resEst);
  if (resEst.status === 201) {
    latenciaEstimacionOk.add(resEst.timings.duration);
  }
  check(resEst, {
    "estimación ok o 429": (r) => r.status === 201 || r.status === 429,
  });

  if (resEst.status === 201) {
    const idEstimacion = resEst.json().id_estimacion;
    const clave = `k6-comb-${__VU}-${__ITER}-${Date.now()}`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.tokenPasajero}`,
      "Clave-Idempotencia": clave,
    };
    const body = JSON.stringify({ id_estimacion: idEstimacion });
    const c1 = http.post(`${data.baseUrl}/viajes`, body, {
      headers,
      tags: { escenario: "viajes", endpoint: "confirmacion" },
    });
    const c2 = http.post(`${data.baseUrl}/viajes`, body, {
      headers,
      tags: { escenario: "viajes", endpoint: "confirmacion_reintento" },
    });
    registrarMetricasHttp(c1);
    registrarMetricasHttp(c2);
    if (c1.status === 201 || c1.status === 200) latenciaConfirmacionOk.add(c1.timings.duration);
    if (c2.status === 201 || c2.status === 200) latenciaConfirmacionOk.add(c2.timings.duration);

    check([c1, c2], {
      "confirmación combinada sin 5xx": ([a, b]) =>
        a.status > 0 && a.status < 500 && b.status > 0 && b.status < 500,
      "reintento idempotente combinado consistente": ([a, b]) =>
        (a.status === 201 || a.status === 200) && (b.status === 201 || b.status === 200)
          ? a.json().id_viaje === b.json().id_viaje
          : true,
    });
  }
  sleep(0.2);
}

export function rafagaFlota(data) {
  const jitterLat = ((__VU + __ITER) % 10) * 0.0002;
  const resUbi = http.post(
    `${data.baseUrl}/choferes/yo/ubicacion`,
    JSON.stringify({
      latitud: Number((-27.451 + jitterLat).toFixed(6)),
      longitud: -58.986,
      actualizado_at: new Date().toISOString(),
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.tokenChofer}`,
      },
      tags: { escenario: "flota", endpoint: "ubicacion" },
    }
  );
  registrarMetricasHttp(resUbi);
  if (resUbi.status === 200) latenciaUbicacionOk.add(resUbi.timings.duration);
  check(resUbi, { "flota ubicación ok o 429": (r) => r.status === 200 || r.status === 429 });

  if (__ITER % 4 === 0) {
    const resBusq = http.get(
      `${data.baseUrl}/choferes/cercanos?latitud=-27.451&longitud=-58.986&radio_metros=5000`,
      {
        headers: { Authorization: `Bearer ${data.tokenPasajero}` },
        tags: { escenario: "flota", endpoint: "cercanos" },
      }
    );
    registrarMetricasHttp(resBusq);
    if (resBusq.status === 200) latenciaBusquedaOk.add(resBusq.timings.duration);
    check(resBusq, { "flota búsqueda ok o 429": (r) => r.status === 200 || r.status === 429 });
  }
}

export function sondaSalud(data) {
  const rHealth = http.get(`${data.baseUrl}/health`, { tags: { endpoint: "health" } });
  const rReady = http.get(`${data.baseUrl}/ready/flota`, { tags: { endpoint: "ready_flota" } });
  latenciaHealthMs.add(rHealth.timings.duration);
  check(rHealth, { "health siempre 200": (r) => r.status === 200 });
  check(rReady, { "ready/flota siempre 200": (r) => r.status === 200 });
}
