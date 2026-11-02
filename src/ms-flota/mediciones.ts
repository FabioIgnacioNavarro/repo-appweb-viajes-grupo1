import { monitorEventLoopDelay } from "node:perf_hooks";

export interface OpcionesMedicionProceso {
  entorno?: NodeJS.ProcessEnv;
  registrar?: (registro: string) => void;
  leerMemoriaProceso?: () => NodeJS.MemoryUsage;
}

/** Instrumentación local y optativa. En ejecución normal queda desactivada. */
export function iniciarMedicionProcesoFlota(opciones: OpcionesMedicionProceso = {}): () => void {
  const entorno = opciones.entorno ?? process.env;
  const habilitada = entorno.MEDICIONES_HABILITADAS ?? "false";
  if (habilitada !== "true" && habilitada !== "false") {
    throw new Error("MEDICIONES_HABILITADAS debe ser true o false.");
  }
  if (habilitada === "false") return () => undefined;

  const intervaloMs = Number(entorno.MEDICIONES_INTERVALO_MS ?? 1000);
  if (!Number.isInteger(intervaloMs) || intervaloMs < 100 || intervaloMs > 60_000) {
    throw new Error("MEDICIONES_INTERVALO_MS debe ser un entero entre 100 y 60000.");
  }

  const histograma = monitorEventLoopDelay({ resolution: 20 });
  const registrar = opciones.registrar ?? ((registro: string) => console.log(registro));
  const leerMemoriaProceso = opciones.leerMemoriaProceso ?? (() => process.memoryUsage());
  histograma.enable();

  const temporizador = setInterval(() => {
    registrar(JSON.stringify({
      evento: "metrica_proceso_flota",
      registrado_en: new Date().toISOString(),
      lag_event_loop_p99_ms: redondear(histograma.percentile(99) / 1_000_000),
      lag_event_loop_max_ms: redondear(histograma.max / 1_000_000),
      ...convertirMemoriaProcesoMiB(leerMemoriaProceso())
    }));
    histograma.reset();
  }, intervaloMs);
  temporizador.unref();

  return () => {
    clearInterval(temporizador);
    histograma.disable();
  };
}

export function convertirMemoriaProcesoMiB(uso: NodeJS.MemoryUsage): {
  memoria_rss_mib: number;
  memoria_heap_usado_mib: number;
  memoria_externa_mib: number;
  memoria_array_buffers_mib: number;
} {
  const mebibytes = 1024 * 1024;
  return {
    memoria_rss_mib: redondear(uso.rss / mebibytes),
    memoria_heap_usado_mib: redondear(uso.heapUsed / mebibytes),
    memoria_externa_mib: redondear(uso.external / mebibytes),
    memoria_array_buffers_mib: redondear(uso.arrayBuffers / mebibytes)
  };
}

function redondear(valor: number): number {
  return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0;
}
