import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend } from "k6/metrics";
import {
  coordenadasResistencia,
  emitirTokenPrueba,
  ipSinteticaUsuario,
  obtenerBaseUrl,
  registrarMetricasHttp,
  uuidSintetico,
} from "./comun.js";

const latenciaEstimacionOk = new Trend("latencia_estimacion_ok_ms", true);
const latenciaConfirmacionOk = new Trend("latencia_confirmacion_ok_ms", true);
const latenciaUbicacionOk = new Trend("latencia_ubicacion_ok_ms", true);
const latenciaLecturasOk = new Trend("latencia_lecturas_ok_ms", true);

const TOTAL_PASAJEROS = 50;
const TOTAL_CHOFERES = 50;
const esSmoke = (__ENV.K6_MODO || "stress").toLowerCase() === "smoke";

export const options = {
  setupTimeout: "120s",
  stages: esSmoke
    ? [
        { duration: "4s", target: 4 },
        { duration: "6s", target: 4 },
        { duration: "2s", target: 0 },
      ]
    : [
        { duration: "5s", target: 25 },
        { duration: "10s", target: 65 },
        { duration: "15s", target: 100 }, // 100 usuarios distintos simultáneos
        { duration: "15s", target: 100 }, // meseta sostenida de 100 usuarios
        { duration: "5s", target: 0 }, // rampa de bajada a 0
        { duration: "4s", target: 0 }, // 4s en 0 para que Prometheus/Grafana registre el cierre limpio en 0 VUs
      ],
  thresholds: {
    errores_5xx: ["rate<0.01"],
    respuestas_429_gateway: ["rate<0.01"],
    latencia_estimacion_ok_ms: ["p(95)<1000", "p(99)<2000"],
    latencia_confirmacion_ok_ms: ["p(95)<2000", "p(99)<4000"],
    latencia_ubicacion_ok_ms: ["p(95)<500", "p(99)<1000"],
    latencia_lecturas_ok_ms: ["p(95)<500", "p(99)<1000"],
    checks: ["rate>0.99"],
  },
};

export function setup() {
  const baseUrl = obtenerBaseUrl();
  const pasajeros = [];
  const choferes = [];

  for (let i = 0; i < TOTAL_PASAJEROS; i += 1) {
    const id = uuidSintetico("aaaa0001", i);
    const ip = ipSinteticaUsuario(i);
    const token = emitirTokenPrueba(baseUrl, id, "pasajero", `Pasajero k6 ${i + 1}`, {
      "X-Forwarded-For": ip,
      __omitirSonda: i === 0 ? "false" : "true",
    });
    pasajeros.push({ id, ip, token, rol: "pasajero" });
  }

  for (let i = 0; i < TOTAL_CHOFERES; i += 1) {
    const habilitadoFlota = i === 0;
    const id = habilitadoFlota
      ? "11111111-1111-4111-8111-111111111111"
      : uuidSintetico("bbbb0002", i);
    const ip = ipSinteticaUsuario(TOTAL_PASAJEROS + i);
    const token = emitirTokenPrueba(baseUrl, id, "chofer", `Chofer k6 ${i + 1}`, {
      "X-Forwarded-For": ip,
      __omitirSonda: i === 0 ? "false" : "true",
    });
    choferes.push({ id, ip, token, rol: "chofer", habilitadoFlota });
  }

  return { baseUrl, pasajeros, choferes };
}

function ejecutarPasajero(baseUrl, usuario, iteracion) {
  const coords = coordenadasResistencia(iteracion);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${usuario.token}`,
    "X-Forwarded-For": usuario.ip,
  };

  group("pasajero_100u_flujo", () => {
    const resEst = http.post(`${baseUrl}/viajes/estimacion`, JSON.stringify(coords), {
      headers,
      tags: { rol: "pasajero", endpoint: "estimacion" },
    });
    registrarMetricasHttp(resEst);
    if (resEst.status === 201) latenciaEstimacionOk.add(resEst.timings.duration);

    check(resEst, {
      "100u estimación responde 201 sin 429/5xx": (r) => r.status === 201,
    });

    if (resEst.status !== 201) return;

    if (iteracion % 2 === 0) {
      const clave = `k6-100u-${usuario.id}-${iteracion}`;
      const body = JSON.stringify({ id_estimacion: resEst.json().id_estimacion });
      const reqHeaders = { ...headers, "Clave-Idempotencia": clave };

      const [c1, c2] = http.batch([
        ["POST", `${baseUrl}/viajes`, body, { headers: reqHeaders, tags: { rol: "pasajero", endpoint: "confirmacion" } }],
        ["POST", `${baseUrl}/viajes`, body, { headers: reqHeaders, tags: { rol: "pasajero", endpoint: "confirmacion_reintento" } }],
      ]);

      registrarMetricasHttp(c1);
      registrarMetricasHttp(c2);
      if (c1.status === 201 || c1.status === 200) latenciaConfirmacionOk.add(c1.timings.duration);
      if (c2.status === 201 || c2.status === 200) latenciaConfirmacionOk.add(c2.timings.duration);

      check([c1, c2], {
        "100u confirmación paralela sin 5xx ni 429": ([a, b]) =>
          (a.status === 201 || a.status === 200) && (b.status === 201 || b.status === 200),
        "100u confirmación paralela conserva mismo id_viaje": ([a, b]) =>
          (a.status === 201 || a.status === 200) &&
          (b.status === 201 || b.status === 200) &&
          a.json().id_viaje === b.json().id_viaje,
      });
    } else {
      const resViajes = http.get(`${baseUrl}/viajes`, {
        headers: { Authorization: headers.Authorization, "X-Forwarded-For": usuario.ip },
        tags: { rol: "pasajero", endpoint: "listar_viajes" },
      });
      registrarMetricasHttp(resViajes);
      if (resViajes.status === 200) latenciaLecturasOk.add(resViajes.timings.duration);
      check(resViajes, {
        "100u listar viajes 200": (r) => r.status === 200,
      });

      const resCercanos = http.get(
        `${baseUrl}/choferes/cercanos?latitud=${coords.origen.latitud}&longitud=${coords.origen.longitud}&radio_metros=5000`,
        {
          headers: { Authorization: headers.Authorization, "X-Forwarded-For": usuario.ip },
          tags: { rol: "pasajero", endpoint: "choferes_cercanos" },
        }
      );
      registrarMetricasHttp(resCercanos);
      if (resCercanos.status === 200) latenciaLecturasOk.add(resCercanos.timings.duration);
      check(resCercanos, {
        "100u choferes cercanos responde 200": (r) => r.status === 200,
      });
    }
  });
}

function ejecutarChofer(baseUrl, usuario, iteracion) {
  const jitterLat = (iteracion % 15) * 0.0003;
  const jitterLng = ((iteracion * 7) % 15) * 0.0003;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${usuario.token}`,
    "X-Forwarded-For": usuario.ip,
  };

  group("chofer_100u_flujo", () => {
    if (usuario.habilitadoFlota) {
      const resUbi = http.post(
        `${baseUrl}/choferes/yo/ubicacion`,
        JSON.stringify({
          latitud: Number((-27.451 + jitterLat).toFixed(6)),
          longitud: Number((-58.986 + jitterLng).toFixed(6)),
          actualizado_at: new Date().toISOString(),
        }),
        { headers, tags: { rol: "chofer", endpoint: "ubicacion" } }
      );
      registrarMetricasHttp(resUbi);
      if (resUbi.status === 200) latenciaUbicacionOk.add(resUbi.timings.duration);

      check(resUbi, {
        "100u ubicación chofer responde 200": (r) => r.status === 200,
      });
    } else {
      const resHistorial = http.get(`${baseUrl}/viajes`, {
        headers: { Authorization: headers.Authorization, "X-Forwarded-For": usuario.ip },
        tags: { rol: "chofer", endpoint: "listar_viajes_chofer" },
      });
      registrarMetricasHttp(resHistorial);
      if (resHistorial.status === 200) latenciaLecturasOk.add(resHistorial.timings.duration);
      check(resHistorial, {
        "100u viajes chofer responde 200": (r) => r.status === 200,
      });
    }

    const resOfertas = http.get(`${baseUrl}/choferes/yo/ofertas`, {
      headers: { Authorization: headers.Authorization, "X-Forwarded-For": usuario.ip },
      tags: { rol: "chofer", endpoint: "ofertas" },
    });
    registrarMetricasHttp(resOfertas);
    if (resOfertas.status === 200) latenciaLecturasOk.add(resOfertas.timings.duration);

    check(resOfertas, {
      "100u ofertas chofer responde 200": (r) => r.status === 200,
    });
  });
}

export default function (data) {
  const indiceVu = __VU - 1;
  if (indiceVu % 2 === 0) {
    const idxPasajero = Math.floor(indiceVu / 2) % data.pasajeros.length;
    ejecutarPasajero(data.baseUrl, data.pasajeros[idxPasajero], __ITER + idxPasajero);
  } else {
    const idxChofer = Math.floor(indiceVu / 2) % data.choferes.length;
    ejecutarChofer(data.baseUrl, data.choferes[idxChofer], __ITER + idxChofer);
  }
  sleep(0.35);
}
