import test from "node:test";
import assert from "node:assert/strict";
import {
  decodificarPayloadJwt,
  extraerRolDesdeClaims,
  iniciarSesion,
  obtenerSesion,
  cerrarSesion,
  estaAutenticado,
  tieneRol,
  obtenerToken,
  suscribirSesion,
} from "./sesion";
import {
  clienteApi,
  peticionHttp,
  generarClaveIdempotencia,
  ErrorHttpApi,
} from "./api";
import { ClienteWebSocket } from "./ws";

test("sesion: decodifica payload JWT en formato falso y estándar", () => {
  const payload = {
    sub: "usr-42",
    idUsuario: "usr-42",
    rol: "CHOFER",
    name: "Carlos Maidana",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const base64Url = Buffer.from(JSON.stringify(payload)).toString("base64url");

  // Caso 1: Token falso de 2 partes (falso.payload)
  const tokenFalso = `falso.${base64Url}`;
  const decodificado1 = decodificarPayloadJwt(tokenFalso);
  assert.equal(decodificado1.idUsuario, "usr-42");
  assert.equal(decodificado1.rol, "CHOFER");

  // Caso 2: Token RS256 estándar de 3 partes (header.payload.signature)
  const tokenReal = `eyJhbGciOiJSUzI1NiJ9.${base64Url}.fake-signature`;
  const decodificado2 = decodificarPayloadJwt(tokenReal);
  assert.equal(decodificado2.idUsuario, "usr-42");
  assert.equal(decodificado2.rol, "CHOFER");

  // Caso 3: Token malformado
  assert.throws(() => decodificarPayloadJwt("token-invalido-sin-puntos"), /Token malformado/);
});

test("sesion: extrae roles estándar, alternativos o aplica fallback seguro", () => {
  assert.equal(extraerRolDesdeClaims({ rol: "PASAJERO" }), "PASAJERO");
  assert.equal(extraerRolDesdeClaims({ role: "CHOFER" }), "CHOFER");
  assert.equal(extraerRolDesdeClaims({ roles: ["ADMINISTRADOR"] }), "ADMINISTRADOR");
  assert.equal(extraerRolDesdeClaims({ rol: "soporte" }), "SOPORTE");
  assert.equal(extraerRolDesdeClaims({ rol: "ROL_INVENTADO" }), "PASAJERO");
  assert.equal(extraerRolDesdeClaims({}), "PASAJERO");
});

test("sesion: ciclo de vida completo (iniciar, verificar, consultar, cerrar y expiración)", () => {
  cerrarSesion();
  assert.equal(estaAutenticado(), false);
  assert.equal(obtenerSesion(), null);

  const payload = {
    sub: "usr-ana",
    idUsuario: "usr-ana",
    rol: "PASAJERO",
    name: "Ana Gómez",
    exp: Math.floor(Date.now() / 1000) + 1800,
  };
  const token = `falso.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;

  let notificado: boolean = false;
  const desuscribir = suscribirSesion((ses) => {
    if (ses && ses.idUsuario === "usr-ana") notificado = true;
  });

  const sesion = iniciarSesion(token);
  assert.equal(sesion.idUsuario, "usr-ana");
  assert.equal(sesion.rol, "PASAJERO");
  assert.equal(estaAutenticado(), true);
  assert.equal(tieneRol(["PASAJERO"]), true);
  assert.equal(tieneRol(["CHOFER", "ADMINISTRADOR"]), false);
  assert.equal(obtenerToken(), token);
  assert.equal(notificado, true);

  desuscribir();
  cerrarSesion();
  assert.equal(estaAutenticado(), false);
  assert.equal(obtenerToken(), null);

  // Expiración automática
  const payloadExpirado = {
    sub: "usr-viejo",
    idUsuario: "usr-viejo",
    rol: "PASAJERO",
    exp: Math.floor(Date.now() / 1000) - 100, // En el pasado
  };
  const tokenExpirado = `falso.${Buffer.from(JSON.stringify(payloadExpirado)).toString("base64url")}`;
  iniciarSesion(tokenExpirado);
  assert.equal(obtenerSesion(), null); // Al consultar detecta expiraEn < now y se auto-cierra
});

test("api: generarClaveIdempotencia produce claves no vacías y no colisionantes", () => {
  const clave1 = generarClaveIdempotencia();
  const clave2 = generarClaveIdempotencia();
  assert.ok(clave1.length > 8);
  assert.ok(clave2.length > 8);
  assert.notEqual(clave1, clave2);
});

test("api: inyecta Authorization Bearer y Clave-Idempotencia automáticamente", async () => {
  const payload = {
    sub: "usr-test",
    idUsuario: "usr-test",
    rol: "CHOFER",
    exp: Math.floor(Date.now() / 1000) + 1000,
  };
  iniciarSesion(`falso.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`);

  let encabezadosCapturados: Headers | null = null;
  const fetchMock = async (_url: RequestInfo | URL, init?: RequestInit) => {
    encabezadosCapturados = new Headers(init?.headers);
    return new Response(JSON.stringify({ viajeId: "v-123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    const res = await clienteApi.post<{ viajeId: string }>(
      "/viajes/confirmar",
      { idEstimacion: "est-1" },
      { claveIdempotencia: "idem-abc" }
    );
    assert.equal(res.viajeId, "v-123");
    assert.ok(encabezadosCapturados);
    assert.match((encabezadosCapturados as Headers).get("Authorization") || "", /^Bearer falso\./);
    assert.equal((encabezadosCapturados as Headers).get("Clave-Idempotencia"), "idem-abc");
    assert.equal((encabezadosCapturados as Headers).get("Content-Type"), "application/json");
  } finally {
    globalThis.fetch = fetchOriginal;
    cerrarSesion();
  }
});

test("api: traduce el sobre uniforme de error { error: { codigo, mensaje, detalles } } en ErrorHttpApi", async () => {
  const fetchMock = async () => {
    return new Response(
      JSON.stringify({
        error: {
          codigo: "ESTIMACION_VENCIDA",
          mensaje: "La cotización de tarifa ha expirado (vigencia 3 minutos).",
          detalles: { vigenciaMinutos: 3 },
        },
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }
    );
  };

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    await assert.rejects(
      async () => {
        await clienteApi.post("/viajes", { idEstimacion: "vencida" });
      },
      (err: ErrorHttpApi) => {
        assert.equal(err.name, "ErrorHttpApi");
        assert.equal(err.status, 409);
        assert.equal(err.codigo, "ESTIMACION_VENCIDA");
        assert.equal(err.mensaje, "La cotización de tarifa ha expirado (vigencia 3 minutos).");
        assert.equal(err.detalles.vigenciaMinutos, 3);
        return true;
      }
    );
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("api: error 401 cierra la sesión local automáticamente", async () => {
  const payload = {
    sub: "usr-caducado",
    idUsuario: "usr-caducado",
    rol: "PASAJERO",
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  iniciarSesion(`falso.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`);
  assert.equal(estaAutenticado(), true);

  const fetchMock = async () => {
    return new Response(
      JSON.stringify({
        error: {
          codigo: "TOKEN_INVALIDO",
          mensaje: "La firma del token fue rechazada.",
          detalles: {},
        },
      }),
      { status: 401 }
    );
  };

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  try {
    await assert.rejects(async () => {
      await clienteApi.get("/viajes/yo");
    });
    // Debe haberse cerrado la sesión
    assert.equal(estaAutenticado(), false);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("ws: cliente WebSocket maneja oyentes, reconexión y despacho de eventos", () => {
  const cliente = new ClienteWebSocket("ws://localhost:9999/ws-test");
  assert.equal(cliente.obtenerEstado(), "DESCONECTADO");

  let eventoRecibido: unknown = null;
  let eventoWildcard: unknown = null;

  const desuscribirTipo = cliente.on("OFERTA_NUEVA", (ev) => {
    eventoRecibido = ev;
  });

  const desuscribirWildcard = cliente.on("*", (ev) => {
    eventoWildcard = ev;
  });

  // Simular despacho interno de evento
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cliente as any).despacharEvento({
    tipo: "OFERTA_NUEVA",
    datos: { idOferta: "of-1", precio: "3000" },
    timestamp: "2026-11-02T23:00:00Z",
  });

  assert.deepEqual(eventoRecibido, {
    tipo: "OFERTA_NUEVA",
    datos: { idOferta: "of-1", precio: "3000" },
    timestamp: "2026-11-02T23:00:00Z",
  });
  assert.deepEqual(eventoWildcard, eventoRecibido);

  desuscribirTipo();
  desuscribirWildcard();
});
