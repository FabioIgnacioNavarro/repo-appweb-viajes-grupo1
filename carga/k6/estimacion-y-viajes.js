import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend } from "k6/metrics";
import {
  coordenadasResistencia,
  emitirTokenPrueba,
  obtenerBaseUrl,
  registrarMetricasHttp,
} from "./comun.js";

const latenciaEstimacionOk = new Trend("latencia_estimacion_ok_ms", true);
const latenciaConfirmacionOk = new Trend("latencia_confirmacion_ok_ms", true);

const esSmoke = (__ENV.K6_MODO || "stress").toLowerCase() === "smoke";

export const options = {
  stages: esSmoke
    ? [
        { duration: "5s", target: 2 },
        { duration: "5s", target: 2 },
        { duration: "2s", target: 0 },
      ]
    : [
        { duration: "8s", target: 3 },   // calentamiento nominal
        { duration: "12s", target: 10 }, // ramp-up de carga
        { duration: "15s", target: 24 }, // stress / pico concurrente
        { duration: "5s", target: 0 },   // recuperación
      ],
  thresholds: {
    errores_5xx: ["rate<0.01"],
    latencia_estimacion_ok_ms: ["p(95)<500", "p(99)<1000"],
    latencia_confirmacion_ok_ms: ["p(95)<1500", "p(99)<3000"],
    checks: ["rate>0.99"],
  },
};

export function setup() {
  const baseUrl = obtenerBaseUrl();
  const tokenPasajero = emitirTokenPrueba(
    baseUrl,
    "22222222-2222-4222-8222-222222222222",
    "pasajero",
    "Pasajero Carga k6"
  );
  return { baseUrl, tokenPasajero };
}

export default function (data) {
  const coords = coordenadasResistencia(__VU * 100 + __ITER);

  group("cotizacion_y_confirmacion_concurrente", () => {
    const resEst = http.post(
      `${data.baseUrl}/viajes/estimacion`,
      JSON.stringify(coords),
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.tokenPasajero}`,
        },
        tags: { endpoint: "estimacion" },
      }
    );

    registrarMetricasHttp(resEst);
    if (resEst.status === 201) {
      latenciaEstimacionOk.add(resEst.timings.duration);
    }

    check(resEst, {
      "estimación responde 201 o 429 bajo stress": (r) => r.status === 201 || r.status === 429,
      "estimación nunca devuelve 5xx": (r) => r.status < 500 && r.status !== 0,
    });

    if (resEst.status !== 201) {
      sleep(0.2);
      return;
    }

    const estimacion = resEst.json();
    const claveIdempotencia = `k6-${__VU}-${__ITER}-${Date.now()}`;
    const headersConfirmacion = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.tokenPasajero}`,
      "Clave-Idempotencia": claveIdempotencia,
    };
    const cuerpo = JSON.stringify({ id_estimacion: estimacion.id_estimacion });

    // Dos POST /viajes simultáneos con idéntica Clave-Idempotencia validan lock transaccional
    const [conf1, conf2] = http.batch([
      [
        "POST",
        `${data.baseUrl}/viajes`,
        cuerpo,
        { headers: headersConfirmacion, tags: { endpoint: "confirmacion" } },
      ],
      [
        "POST",
        `${data.baseUrl}/viajes`,
        cuerpo,
        { headers: headersConfirmacion, tags: { endpoint: "confirmacion_reintento" } },
      ],
    ]);

    registrarMetricasHttp(conf1);
    registrarMetricasHttp(conf2);

    if (conf1.status === 201 || conf1.status === 200) {
      latenciaConfirmacionOk.add(conf1.timings.duration);
    }
    if (conf2.status === 201 || conf2.status === 200) {
      latenciaConfirmacionOk.add(conf2.timings.duration);
    }

    check([conf1, conf2], {
      "confirmaciones sin 5xx": ([a, b]) =>
        a.status > 0 && a.status < 500 && b.status > 0 && b.status < 500,
      "confirmación paralela idempotente conserva mismo id_viaje": ([a, b]) => {
        if ((a.status === 201 || a.status === 200) && (b.status === 201 || b.status === 200)) {
          const j1 = a.json();
          const j2 = b.json();
          return j1.id_viaje === j2.id_viaje && j1.precio_estimado === j2.precio_estimado;
        }
        return true;
      },
    });
  });

  sleep(0.15);
}
