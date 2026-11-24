import { context, logs, metrics, propagation, ROOT_CONTEXT, SeverityNumber, SpanStatusCode, trace, type Attributes, type Context, type Span } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchLogRecordProcessor, type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader, type IMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanProcessor } from "@opentelemetry/sdk-trace";
import type { NextFunction, Request, Response } from "express";

let sdkInstancia: NodeSDK | null = null;

export interface ContextoTrazaActivo {
  traceId?: string;
  spanId?: string;
}

export interface MetricaSolicitudHttp {
  servicio: string;
  metodo: string;
  ruta: string;
  estadoHttp: number;
  duracionSegundos: number;
}

export type NivelLog = "INFO" | "WARN" | "ERROR";
export type AtributosLog = Record<string, string | number | boolean | undefined>;
export type RegistrarMetricaSolicitud = (metrica: MetricaSolicitudHttp) => void;

let registrarMetricaOtelActiva: RegistrarMetricaSolicitud = () => {};
const descartarSpansSinDestino: SpanProcessor = {
  onStart: () => {},
  onEnd: () => {},
  forceFlush: async () => {},
  shutdown: async () => {}
};

/**
 * Inicializa el SDK para este proceso. Trazas conservan Jaeger como destino local;
 * métricas y logs se habilitan explícitamente al usar OTEL_*_EXPORTER=otlp.
 */
export function iniciarObservabilidad(nombreServicio: string): void {
  if (sdkInstancia) return;

  const encabezados = interpretarEncabezadosOtlp(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  const tiempoMaximo = leerEnteroPositivo(process.env.OTEL_EXPORTER_OTLP_TIMEOUT, 1500);
  const urlTrazas = obtenerEndpointOtlp("TRACES");
  const urlMetricas = obtenerEndpointOtlp("METRICS");
  const urlLogs = obtenerEndpointOtlp("LOGS");

  const exportadorTrazas = urlTrazas
    ? new OTLPTraceExporter({ url: urlTrazas, headers: encabezados, timeoutMillis: tiempoMaximo })
    : undefined;

  const metricReaders: IMetricReader[] = [];
  if (process.env.OTEL_METRICS_EXPORTER?.trim().toLowerCase() === "otlp" && urlMetricas) {
    const exportadorMetricas = new OTLPMetricExporter({ url: urlMetricas, headers: encabezados, timeoutMillis: tiempoMaximo });
    metricReaders.push(new PeriodicExportingMetricReader({
      exporter: exportadorMetricas,
      exportIntervalMillis: leerEnteroPositivo(process.env.OTEL_METRIC_EXPORT_INTERVAL, 10_000),
      exportTimeoutMillis: tiempoMaximo
    }));
  }

  const procesadoresLogs: LogRecordProcessor[] = [];
  if (process.env.OTEL_LOGS_EXPORTER?.trim().toLowerCase() === "otlp" && urlLogs) {
    const exportadorLogs = new OTLPLogExporter({ url: urlLogs, headers: encabezados, timeoutMillis: tiempoMaximo });
    procesadoresLogs.push(new BatchLogRecordProcessor({ exporter: exportadorLogs }));
  }

  sdkInstancia = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? nombreServicio,
    traceExporter: exportadorTrazas,
    spanProcessors: exportadorTrazas ? undefined : [descartarSpansSinDestino],
    metricReaders,
    logRecordProcessors: procesadoresLogs
  });

  try {
    sdkInstancia.start();
    if (metricReaders.length > 0) inicializarInstrumentosHttp();
  } catch {
    // La instrumentación nunca debe impedir que arranque el servicio de negocio.
    console.error(JSON.stringify({ evento: "otel_inicio_fallido", servicio: nombreServicio }));
  }

  const cerrarOtel = async () => {
    if (!sdkInstancia) return;
    try {
      await sdkInstancia.shutdown();
    } catch {
      // El cierre continúa incluso si el colector remoto no responde.
    } finally {
      sdkInstancia = null;
    }
  };

  process.once("SIGTERM", () => { void cerrarOtel(); });
  process.once("SIGINT", () => { void cerrarOtel(); });
}

/** Obtiene el trazador del dominio. */
export function obtenerTrazador(nombre: string = "viajes-sistema") {
  return trace.getTracer(nombre);
}

/** Obtiene los identificadores activos para correlacionar eventos de aplicación. */
export function obtenerContextoTraza(): ContextoTrazaActivo {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

/** Emite el encabezado estándar W3C traceparent en una llamada saliente. */
export function inyectarContextoW3C(headers: Record<string, string>): void {
  propagation.inject(context.active(), headers);
}

/** Extrae el contexto W3C de los encabezados recibidos. */
export function extraerContextoW3C(headers: Record<string, string | string[] | undefined>): Context {
  const headersNormalizados: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(headers)) {
    if (typeof valor === "string") headersNormalizados[clave.toLowerCase()] = valor;
    else if (Array.isArray(valor) && valor.length > 0 && typeof valor[0] === "string") headersNormalizados[clave.toLowerCase()] = valor[0];
  }
  return propagation.extract(ROOT_CONTEXT, headersNormalizados);
}

/**
 * Registra el mismo evento como JSON en stdout/stderr y como LogRecord OTLP.
 * Las claves sensibles se eliminan antes de serializar para evitar exportarlas.
 */
export function registrarLogEstructurado(registro: AtributosLog, nivel: NivelLog = "INFO"): void {
  const seguro = filtrarAtributosSensibles({ ...obtenerContextoTraza(), ...registro });
  const json = JSON.stringify(seguro);
  if (nivel === "ERROR") console.error(json);
  else if (nivel === "WARN") console.warn(json);
  else console.log(json);

  const nivelOtel = nivel === "ERROR" ? SeverityNumber.ERROR : nivel === "WARN" ? SeverityNumber.WARN : SeverityNumber.INFO;
  const atributos: Attributes = Object.fromEntries(
    Object.entries(seguro).filter((entrada): entrada is [string, string | number | boolean] => entrada[1] !== undefined)
  );
  logs.getLogger("viajes.aplicacion", "1.0.0").emit({
    severityNumber: nivelOtel,
    severityText: nivel,
    body: json,
    attributes: atributos
  });
}

/** Ejecuta una operación asíncrona dentro de un span hijo y registra su error. */
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
    } catch (error: unknown) {
      const mensaje = error instanceof Error ? error.message : String(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: mensaje });
      span.recordException(error instanceof Error ? error : mensaje);
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Middleware HTTP con traza distribuida y métricas por ruta de Express de baja cardinalidad. */
export function middlewareObservabilidad(nombreServicio: string, registrarMetrica: RegistrarMetricaSolicitud = registrarMetricaOtel): (req: Request, res: Response, next: NextFunction) => void {
  const tracer = obtenerTrazador(nombreServicio);

  return (req: Request, res: Response, next: NextFunction): void => {
    const ctxEntrante = extraerContextoW3C(req.headers);
    const inicio = process.hrtime.bigint();
    const span = tracer.startSpan(`HTTP ${req.method}`, {
      attributes: {
        "http.request.method": req.method,
        "service.name": nombreServicio
      }
    }, ctxEntrante);

    const spanCtx = span.spanContext();
    if (spanCtx.traceId) res.setHeader("X-Trace-Id", spanCtx.traceId);

    context.with(trace.setSpan(ctxEntrante, span), () => {
      res.once("finish", () => {
        const ruta = rutaExpressDeBajaCardinalidad(req);
        const duracionSegundos = Number(process.hrtime.bigint() - inicio) / 1_000_000_000;
        span.updateName(`${req.method} ${ruta}`);
        span.setAttributes({
          "http.route": ruta,
          "http.response.status_code": res.statusCode
        });
        if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.statusCode}` });
        else span.setStatus({ code: SpanStatusCode.OK });
        registrarMetrica({ servicio: nombreServicio, metodo: req.method, ruta, estadoHttp: res.statusCode, duracionSegundos });
        span.end();
      });

      next();
    });
  };
}

/** Convierte el formato oficial `clave=valor,clave2=valor2` a encabezados HTTP. */
export function interpretarEncabezadosOtlp(valor: string | undefined): Record<string, string> {
  if (!valor?.trim()) return {};
  const encabezados: Record<string, string> = {};
  for (const par of valor.split(",")) {
    const separador = par.indexOf("=");
    if (separador <= 0) continue;
    const clave = decodificarComponenteOtlp(par.slice(0, separador).trim());
    const contenido = decodificarComponenteOtlp(par.slice(separador + 1).trim());
    if (clave && contenido) encabezados[clave] = contenido;
  }
  return encabezados;
}

function obtenerEndpointOtlp(senal: "TRACES" | "METRICS" | "LOGS"): string | undefined {
  const especifico = process.env[`OTEL_EXPORTER_OTLP_${senal}_ENDPOINT`]?.trim();
  if (especifico) return especifico;
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim().replace(/\/+$/, "");
  if (!base) return undefined;
  if (senal === "TRACES" && base.endsWith("/v1/traces")) return base;
  return `${base}/v1/${senal.toLowerCase()}`;
}

function leerEnteroPositivo(valor: string | undefined, predeterminado: number): number {
  if (!valor?.trim()) return predeterminado;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : predeterminado;
}

function decodificarComponenteOtlp(valor: string): string {
  try { return decodeURIComponent(valor); }
  catch { return valor; }
}

function filtrarAtributosSensibles(registro: AtributosLog): AtributosLog {
  const resultado: AtributosLog = {};
  for (const [clave, valor] of Object.entries(registro)) {
    if (/authorization|token|password|secret|api.?key|cookie/i.test(clave) || valor === undefined) continue;
    resultado[clave] = typeof valor === "string" ? valor.replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [REDACTADO]") : valor;
  }
  return resultado;
}

function registrarMetricaOtel(metrica: MetricaSolicitudHttp): void {
  registrarMetricaOtelActiva(metrica);
}

function inicializarInstrumentosHttp(): void {
  // Crear los instrumentos después de sdk.start(): antes de registrar el MeterProvider,
  // la API de OpenTelemetry devuelve instrumentos no-op que descartan las mediciones.
  const medidorHttp = metrics.getMeter("viajes.http", "1.0.0");
  const solicitudesHttp = medidorHttp.createCounter("viajes.http.solicitudes", {
    description: "Cantidad de solicitudes HTTP finalizadas por microservicio",
    unit: "{solicitud}"
  });
  const duracionSolicitudesHttp = medidorHttp.createHistogram("viajes.http.duracion", {
    description: "Duración de solicitudes HTTP finalizadas en segundos",
    unit: "s"
  });

  registrarMetricaOtelActiva = (metrica) => {
    const atributos = {
      "service.name": metrica.servicio,
      "http.request.method": metrica.metodo,
      "http.route": metrica.ruta,
      "http.response.status_code": metrica.estadoHttp
    };
    solicitudesHttp.add(1, atributos);
    duracionSolicitudesHttp.record(metrica.duracionSegundos, atributos);
  };
}

function rutaExpressDeBajaCardinalidad(req: Request): string {
  const ruta = req.route?.path;
  if (typeof ruta === "string") return `${req.baseUrl ?? ""}${ruta}` || "/";
  if (Array.isArray(ruta)) return `${req.baseUrl ?? ""}${ruta[0] ?? "*"}`;
  return "ruta_no_encontrada";
}
