import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend } from "k6/metrics";
import {
  emitirTokenPrueba,
  latenciaHealthMs,
  obtenerBaseUrl,
  registrarMetricasHttp,
} from "./comun.js";

const latenciaUbicacionOk = new Trend("latencia_ubicacion_ok_ms", true);
const latenciaBusquedaOk = new Trend("latencia_busqueda_ok_ms", true);

const esSmoke = (__ENV.K6_MODO || "stress").toLowerCase() === "smoke";

export const options = {
  stages: esSmoke
    ? [
        { duration: "5s", target: 2 },
        { duration: "5s", target: 2 },
        { duration: "2s", target: 0 },
      ]
    : [
        { duration: "8s", target: 4 },   // carga nominal
        { duration: "12s", target: 15 }, // ramp-up de escrituras/lecturas
        { duration: "15s", target: 32 }, // ráfaga / stress pico
        { duration: "5s", target: 0 },   // enfriamiento
      ],
  thresholds: {
    errores_5xx: ["rate<0.01"],
    latencia_ubicacion_ok_ms: ["p(95)<300", "p(99)<600"],
    latencia_busqueda_ok_ms: ["p(95)<300", "p(99)<600"],
    checks: ["rate>0.99"],
  },
};

export function setup() {
  const baseUrl = obtenerBaseUrl();
  const tokenChofer = emitirTokenPrueba(
    baseUrl,
    "11111111-1111-4111-8111-111111111111",
    "chofer",
    "Chofer Carga k6"
  );
  const tokenPasajero = emitirTokenPrueba(
    baseUrl,
    "22222222-2222-4222-8222-222222222222",
    "pasajero",
    "Pasajero Carga k6"
  );

  // Asegurar disponibilidad activa del chofer sintético
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

  return { baseUrl, tokenChofer, tokenPasajero };
}

export default function (data) {
  group("flota_ubicacion_y_busqueda", () => {
    const jitterLat = ((__VU + __ITER) % 10) * 0.0002;
    const jitterLng = ((__VU * 3 + __ITER) % 10) * 0.0002;

    const resUbi = http.post(
      `${data.baseUrl}/choferes/yo/ubicacion`,
      JSON.stringify({
        latitud: Number((-27.451 + jitterLat).toFixed(6)),
        longitud: Number((-58.986 + jitterLng).toFixed(6)),
        actualizado_at: new Date().toISOString(),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.tokenChofer}`,
        },
        tags: { endpoint: "ubicacion" },
      }
    );

    registrarMetricasHttp(resUbi);
    if (resUbi.status === 200) {
      latenciaUbicacionOk.add(resUbi.timings.duration);
    }

    check(resUbi, {
      "ubicación responde 200 o 429": (r) => r.status === 200 || r.status === 429,
      "ubicación sin errores 5xx": (r) => r.status > 0 && r.status < 500,
    });

    if (__ITER % 3 === 0) {
      const resCercanos = http.get(
        `${data.baseUrl}/choferes/cercanos?latitud=-27.451&longitud=-58.986&radio_metros=5000`,
        {
          headers: { Authorization: `Bearer ${data.tokenPasajero}` },
          tags: { endpoint: "cercanos" },
        }
      );

      registrarMetricasHttp(resCercanos);
      if (resCercanos.status === 200) {
        latenciaBusquedaOk.add(resCercanos.timings.duration);
      }

      check(resCercanos, {
        "cercanos responde 200 o 429": (r) => r.status === 200 || r.status === 429,
        "cercanos sin errores 5xx": (r) => r.status > 0 && r.status < 500,
      });
    }

    if (__ITER % 5 === 0) {
      const resHealth = http.get(`${data.baseUrl}/health`, { tags: { endpoint: "health" } });
      latenciaHealthMs.add(resHealth.timings.duration);
      check(resHealth, { "gateway /health responde 200": (r) => r.status === 200 });
    }
  });

  sleep(0.1);
}
