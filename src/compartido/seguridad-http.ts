import type { NextFunction, Request, Response } from "express";

/**
 * Traduce errores de parseo JSON y cuerpos que exceden `limit` al sobre uniforme sin filtrar trazas.
 */
export function manejarErrorCuerpoHttp(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!err || typeof err !== "object") {
    next(err);
    return;
  }
  const errorObj = err as { type?: string; status?: number; statusCode?: number };
  if (errorObj.type === "entity.too.large" || errorObj.status === 413 || errorObj.statusCode === 413) {
    res.status(413).json({
      error: {
        codigo: "PAYLOAD_DEMASIADO_GRANDE",
        mensaje: "El cuerpo de la petición excede el límite máximo permitido.",
        detalles: {}
      }
    });
    return;
  }
  if (
    errorObj.type === "entity.parse.failed" ||
    (err instanceof SyntaxError && (errorObj.status === 400 || errorObj.statusCode === 400))
  ) {
    res.status(400).json({
      error: {
        codigo: "ENTRADA_INVALIDA",
        mensaje: "El cuerpo JSON está malformado.",
        detalles: {}
      }
    });
    return;
  }
  next(err);
}
