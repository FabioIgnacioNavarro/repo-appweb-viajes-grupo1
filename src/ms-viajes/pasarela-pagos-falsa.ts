import type { Cobro, PasarelaPagos } from "./dominio";

/**
 * Adaptador de demo: confirma el cobro en el primer intento.
 * Repetir la misma clave reproduce exactamente el mismo resultado.
 */
export class PasarelaPagosFalsa implements PasarelaPagos {
  private readonly resultadosPorClave = new Map<string, "FALLIDO" | "CONFIRMADO">();
  private readonly enProcesoPorCobro = new Map<string, Promise<"FALLIDO" | "CONFIRMADO">>();

  async procesar(cobro: Cobro, claveIdempotencia: string): Promise<"FALLIDO" | "CONFIRMADO"> {
    const clave = `${cobro.id}:${claveIdempotencia}`;
    const resultadoGuardado = this.resultadosPorClave.get(clave);
    if (resultadoGuardado) return resultadoGuardado;

    const operacionEnCurso = this.enProcesoPorCobro.get(cobro.id);
    if (operacionEnCurso) {
      const resultado = await operacionEnCurso;
      this.resultadosPorClave.set(clave, resultado);
      return resultado;
    }

    const resultado: "FALLIDO" | "CONFIRMADO" = "CONFIRMADO";
    const operacion = Promise.resolve(resultado);
    this.enProcesoPorCobro.set(cobro.id, operacion);
    try {
      const resultado = await operacion;
      this.resultadosPorClave.set(clave, resultado);
      return resultado;
    } finally {
      this.enProcesoPorCobro.delete(cobro.id);
    }
  }
}
