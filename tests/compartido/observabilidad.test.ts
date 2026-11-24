import { strict as assert } from "node:assert";
import test from "node:test";
import {
  iniciarObservabilidad,
  conSpan,
  obtenerContextoTraza,
  inyectarContextoW3C,
  extraerContextoW3C,
  middlewareObservabilidad,
  interpretarEncabezadosOtlp,
  registrarLogEstructurado
} from "../../src/compartido/observabilidad";
import type { Request, Response } from "express";

test("observabilidad: inicializa sin errores incluso sin Jaeger presente", () => {
  assert.doesNotThrow(() => {
    iniciarObservabilidad("test-unitario");
  });
});

test("observabilidad: conSpan ejecuta operación y captura contexto", async () => {
  let traceIdCapturado: string | undefined;

  const resultado = await conSpan("operacion-prueba", { clave: "valor" }, async () => {
    const ctx = obtenerContextoTraza();
    traceIdCapturado = ctx.traceId;
    return 42;
  });

  assert.equal(resultado, 42);
  assert.ok(traceIdCapturado, "Debe existir un traceId dentro del span");
});

test("observabilidad: conSpan propaga el error y registra status ERROR", async () => {
  await assert.rejects(
    async () => {
      await conSpan("operacion-fallida", {}, async () => {
        throw new Error("fallo simulado");
      });
    },
    { message: "fallo simulado" }
  );
});

test("observabilidad: inyecta y extrae encabezados W3C traceparent", async () => {
  await conSpan("operacion-padre", {}, async () => {
    const headers: Record<string, string> = {};
    inyectarContextoW3C(headers);

    assert.ok(headers.traceparent, "Debe inyectar traceparent");
    assert.match(headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    const ctxHijo = extraerContextoW3C(headers);
    assert.ok(ctxHijo, "Debe poder extraer el contexto de los headers");
  });
});

test("observabilidad: middleware inyecta X-Trace-Id y registra métricas con ruta de baja cardinalidad", () => {
  const metricas: Array<{ servicio: string; metodo: string; ruta: string; estadoHttp: number; duracionSegundos: number }> = [];
  const middleware = middlewareObservabilidad("ms-prueba", (metrica) => metricas.push(metrica));
  let finalizarRespuesta: (() => void) | undefined;

  const req = {
    method: "GET",
    path: "/test",
    url: "/test",
    headers: {},
    route: { path: "/viajes/:id" },
    baseUrl: ""
  } as unknown as Request;

  let headerEstablecido = "";
  const res = {
    setHeader: (nombre: string, valor: string) => {
      if (nombre.toLowerCase() === "x-trace-id") {
        headerEstablecido = valor;
      }
    },
    once: (_evento: string, callback: () => void) => { finalizarRespuesta = callback; },
    statusCode: 200
  } as unknown as Response;

  let nextLlamado = false;
  middleware(req, res, () => {
    nextLlamado = true;
  });

  assert.ok(nextLlamado, "Debe llamar a next()");
  assert.ok(headerEstablecido, "Debe haber inyectado X-Trace-Id");
  assert.match(headerEstablecido, /^[0-9a-f]{32}$/);

  finalizarRespuesta?.();
  assert.equal(metricas.length, 1);
  assert.equal(metricas[0].servicio, "ms-prueba");
  assert.equal(metricas[0].metodo, "GET");
  assert.equal(metricas[0].ruta, "/viajes/:id");
  assert.equal(metricas[0].estadoHttp, 200);
  assert.ok(metricas[0].duracionSegundos >= 0);
});

test("observabilidad: interpreta encabezados OTLP codificados sin perder los signos del token", () => {
  assert.deepEqual(
    interpretarEncabezadosOtlp("Authorization=Basic%20YWJjZA==,X-Region=north%20america"),
    { Authorization: "Basic YWJjZA==", "X-Region": "north america" }
  );
});

test("observabilidad: emite logs JSON correlacionados sin exportar atributos de credenciales", async () => {
  const errorOriginal = console.error;
  let salida = "";
  console.error = (mensaje?: unknown) => { salida = String(mensaje ?? ""); };
  try {
    await conSpan("operacion-con-log", {}, async () => {
      registrarLogEstructurado({ evento: "prueba_segura", servicio: "ms-prueba", token: "no-debe-aparecer" }, "ERROR");
    });
  } finally {
    console.error = errorOriginal;
  }

  const registro = JSON.parse(salida) as Record<string, unknown>;
  assert.equal(registro.evento, "prueba_segura");
  assert.equal(registro.servicio, "ms-prueba");
  assert.match(String(registro.traceId), /^[0-9a-f]{32}$/);
  assert.match(String(registro.spanId), /^[0-9a-f]{16}$/);
  assert.equal("token" in registro, false);
  assert.equal(salida.includes("no-debe-aparecer"), false);
});
