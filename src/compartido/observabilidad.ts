import { trace, context, propagation, SpanStatusCode, ROOT_CONTEXT, type Span, type Context, diag, DiagLogLevel, DiagConsoleLogger } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { Request, Response, NextFunction } from "express";

let sdkInstancia: NodeSDK | null = null;

export interface ContextoTrazaActivo {
  traceId?: string;
  spanId?: string;
}

/**
 * Inicializa el SDK de OpenTelemetry para el servicio actual.
 * Si no hay endpoint configurado o en entorno de tests, opera sin exporter de red para no fallar.
 */
export function iniciarObservabilidad(nombreServicio: string): void {
  if (sdkInstancia) return;

  const endpointOtlp = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const exporter = endpointOtlp
    ? new OTLPTraceExporter({
        url: endpointOtlp.endsWith("/v1/traces") ? endpointOtlp : `${endpointOtlp.replace(/\/$/, "")}/v1/traces`,
        timeoutMillis: 1500
      })
    : undefined;

  sdkInstancia = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? nombreServicio,
    traceExporter: exporter
  });

  try {
    sdkInstancia.start();
  } catch (error) {
    console.error(JSON.stringify({ evento: "otel_inicio_fallido", error: String(error) }));
  }

  const cerrarOtel = async () => {
    if (sdkInstancia) {
      try {
        await sdkInstancia.shutdown();
      } catch {
        // Cierre silencioso ante caídas de Jaeger
      } finally {
        sdkInstancia = null;
      }
    }
  };

  process.once("SIGTERM", () => { void cerrarOtel(); });
  process.once("SIGINT", () => { void cerrarOtel(); });
}

/** Obtiene el trazador del dominio */
export function obtenerTrazador(nombre: string = "viajes-sistema") {
  return trace.getTracer(nombre);
}

/** Obtiene el trace_id y span_id activos para correlación en logs */
export function obtenerContextoTraza(): ContextoTrazaActivo {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const ctx = span.spanContext();
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId
  };
}

/** Inyecta el encabezado estándar W3C traceparent en los headers de una petición saliente */
export function inyectarContextoW3C(headers: Record<string, string>): void {
  propagation.inject(context.active(), headers);
}

/** Extrae el contexto W3C recibido en encabezados entrantes */
export function extraerContextoW3C(headers: Record<string, string | string[] | undefined>): Context {
  const headersNormalizados: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(headers)) {
    if (typeof valor === "string") {
      headersNormalizados[clave.toLowerCase()] = valor;
    } else if (Array.isArray(valor) && valor.length > 0 && typeof valor[0] === "string") {
      headersNormalizados[clave.toLowerCase()] = valor[0];
    }
  }
  return propagation.extract(ROOT_CONTEXT, headersNormalizados);
}

/**
 * Ejecuta una operación asíncrona dentro de un span de OpenTelemetry hijo.
 * Registra status ERROR si la promesa es rechazada.
 */
export async function conSpan<T>(
  nombre: string,
  atributos: Record<string, string | number | boolean> = {},
  operacion: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = obtenerTrazador();
  return tracer.startActiveSpan(nombre, { attributes: atributos }, async (span) => {
    try {
      const resultado = await operacion(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return resultado;
    } catch (error: any) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error?.message ?? String(error)
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Middleware de Express para instrumentar automáticamente peticiones entrantes.
 * Extrae o inicia la traza W3C y propaga traceId en la respuesta.
 */
export function middlewareObservabilidad(nombreServicio: string) {
  const tracer = obtenerTrazador(nombreServicio);

  return (req: Request, res: Response, next: NextFunction): void => {
    const ctxEntrante = extraerContextoW3C(req.headers);
    const nombreSpan = `${req.method} ${req.route?.path ?? req.path}`;

    const span = tracer.startSpan(
      nombreSpan,
      {
        attributes: {
          "http.method": req.method,
          "http.target": req.originalUrl || req.url,
          "service.name": nombreServicio
        }
      },
      ctxEntrante
    );

    const spanCtx = span.spanContext();
    if (spanCtx.traceId) {
      res.setHeader("X-Trace-Id", spanCtx.traceId);
    }

    context.with(trace.setSpan(ctxEntrante, span), () => {
      res.on("finish", () => {
        span.setAttribute("http.status_code", res.statusCode);
        if (res.statusCode >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.statusCode}` });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        span.end();
      });

      next();
    });
  };
}
