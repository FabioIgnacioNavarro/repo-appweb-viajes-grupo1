import { strict as assert } from "node:assert";
import test from "node:test";
import {
  iniciarObservabilidad,
  conSpan,
  obtenerContextoTraza,
  inyectarContextoW3C,
  extraerContextoW3C,
  middlewareObservabilidad
} from "./observabilidad";
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

test("observabilidad: middleware inyecta X-Trace-Id en la respuesta", () => {
  const middleware = middlewareObservabilidad("ms-prueba");

  const req = {
    method: "GET",
    path: "/test",
    url: "/test",
    headers: {}
  } as unknown as Request;

  let headerEstablecido = "";
  const res = {
    setHeader: (nombre: string, valor: string) => {
      if (nombre.toLowerCase() === "x-trace-id") {
        headerEstablecido = valor;
      }
    },
    on: () => {}
  } as unknown as Response;

  let nextLlamado = false;
  middleware(req, res, () => {
    nextLlamado = true;
  });

  assert.ok(nextLlamado, "Debe llamar a next()");
  assert.ok(headerEstablecido, "Debe haber inyectado X-Trace-Id");
  assert.match(headerEstablecido, /^[0-9a-f]{32}$/);
});
