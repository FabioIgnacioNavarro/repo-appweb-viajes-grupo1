import http from "k6/http";
import { Rate, Trend } from "k6/metrics";

export const errores5xx = new Rate("errores_5xx");
export const rateLimit429 = new Rate("respuestas_429_gateway");
export const latenciaHealthMs = new Trend("latencia_health_ms", true);

const TOKENS_FALSOS = {
  pasajero:
    "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyIiwicm9sIjoiUEFTQUpFUk8ifQ",
  chofer:
    "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwicm9sIjoiQ0hPRkVSIn0",
};

export function obtenerBaseUrl() {
  return (__ENV.BASE_URL || "http://localhost:8080").replace(/\/$/, "");
}

export function ipSinteticaUsuario(indice) {
  const octeto3 = Math.floor(indice / 250) + 1;
  const octeto4 = (indice % 250) + 1;
  return `10.100.${octeto3}.${octeto4}`;
}

export function uuidSintetico(prefijoHex, indice) {
  const sufijo = String(indice + 1).padStart(12, "0");
  return `${prefijoHex}-0000-4000-8000-${sufijo}`;
}

export function emitirTokenPrueba(baseUrl, idUsuario, rol, nombre, headersExtra = {}) {
  const rolLower = rol.toLowerCase();
  const res = http.post(
    `${baseUrl}/auth/token`,
    JSON.stringify({ id_usuario: idUsuario, rol: rolLower, nombre }),
    { headers: { "Content-Type": "application/json", ...headersExtra } }
  );

  if (res.status === 200) {
    try {
      const data = res.json();
      if (data && typeof data.token === "string" && data.token.length > 10) {
        if (headersExtra.__omitirSonda === "true") {
          return data.token;
        }
        const rutaSonda = rolLower === "chofer" ? "/choferes/yo/ofertas" : "/viajes";
        const sonda = http.get(`${baseUrl}${rutaSonda}`, {
          headers: { Authorization: `Bearer ${data.token}`, ...headersExtra },
        });
        if (sonda.status !== 401) {
          return data.token;
        }
      }
    } catch {
      // sigue con token falso si el entorno usa JWT_MODO=falso
    }
  }

  const fallback = TOKENS_FALSOS[rolLower];
  if (fallback) {
    return fallback;
  }
  throw new Error(`No se pudo obtener token válido para rol=${rol} en ${baseUrl}`);
}

export function registrarMetricasHttp(res) {
  const esErrorInfra = res.status === 0 || res.status >= 500;
  errores5xx.add(esErrorInfra ? 1 : 0);
  rateLimit429.add(res.status === 429 ? 1 : 0);
}

export function coordenadasResistencia(indice) {
  const deltaLat = ((indice % 7) - 3) * 0.0025;
  const deltaLng = (((indice * 3) % 7) - 3) * 0.0025;
  return {
    origen: {
      latitud: Number((-27.45213 + deltaLat).toFixed(5)),
      longitud: Number((-58.98738 + deltaLng).toFixed(5)),
    },
    destino: {
      latitud: Number((-27.43159 - deltaLat).toFixed(5)),
      longitud: Number((-58.96306 - deltaLng).toFixed(5)),
    },
  };
}
