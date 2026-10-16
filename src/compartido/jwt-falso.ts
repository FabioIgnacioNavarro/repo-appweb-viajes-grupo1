import type { ActorJWT, RolJWT, ValidadorToken } from "./jwt";

const ROLES: RolJWT[] = ["PASAJERO", "CHOFER", "SOPORTE", "ADMINISTRADOR"];

/** Proveedor offline para desarrollo y tests. No firma tokens ni debe usarse en producción. */
export class ValidadorJwtFalso implements ValidadorToken {
  constructor(private readonly permitirSoloDesarrollo = true) {}

  generar(actor: ActorJWT): string {
    validarActor(actor);
    return `falso.${Buffer.from(JSON.stringify({ tipo: "jwt-falso", ...actor }), "utf8").toString("base64url")}`;
  }

  async validar(token: string): Promise<ActorJWT> {
    if (this.permitirSoloDesarrollo && process.env.NODE_ENV === "production") throw new Error("JWT falso deshabilitado en producción.");
    const [prefijo, cuerpo] = token.split(".");
    if (prefijo !== "falso" || !cuerpo) throw new Error("Token falso inválido.");
    let payload: unknown;
    try { payload = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")); } catch { throw new Error("Token falso inválido."); }
    if (!esObjeto(payload) || payload.tipo !== "jwt-falso" || typeof payload.idUsuario !== "string" || typeof payload.rol !== "string") throw new Error("Token falso inválido.");
    const actor = { idUsuario: payload.idUsuario, rol: payload.rol as RolJWT };
    validarActor(actor);
    return actor;
  }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> { return typeof valor === "object" && valor !== null; }
function validarActor(actor: ActorJWT): void { if (!actor.idUsuario || !ROLES.includes(actor.rol)) throw new Error("Actor falso inválido."); }
