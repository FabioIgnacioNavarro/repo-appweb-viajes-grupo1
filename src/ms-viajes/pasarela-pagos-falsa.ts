import type { Cobro, PasarelaPagos } from "./dominio";

/**
 * Adaptador de demo: el primer intento de cada cobro falla y el siguiente
 * confirma. Repetir la misma clave reproduce exactamente el mismo resultado.
 */
export class PasarelaPagosFalsa implements PasarelaPagos {
  private readonly resultadosPorClave = new Map<string, "FALLIDO" | "CONFIRMADO">();
  private readonly intentosPorCobro = new Map<string, number>();
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

    const numeroIntento = this.intentosPorCobro.get(cobro.id) ?? 0;
    this.intentosPorCobro.set(cobro.id, numeroIntento + 1);
    const resultado: "FALLIDO" | "CONFIRMADO" = numeroIntento === 0 ? "FALLIDO" : "CONFIRMADO";
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
