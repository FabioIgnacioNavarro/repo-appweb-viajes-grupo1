import { createPublicKey, verify as verificarFirma } from "node:crypto";

export type RolJWT = "PASAJERO" | "CHOFER" | "SOPORTE" | "ADMINISTRADOR";
export interface ActorJWT { idUsuario: string; rol: RolJWT; }
type ClaveJwk = { kid?: string; kty: string; use?: string; alg?: string; [clave: string]: unknown };
type PayloadJWT = { sub?: string; iss?: string; aud?: string | string[]; exp?: number; nbf?: number; [clave: string]: unknown };

/** Validador RS256 con JWKS remoto; no implementa login ni acepta tokens sin firma. */
export class ValidadorJwtJwks {
  private claves?: { vencimiento: number; claves: ClaveJwk[] };
  constructor(private readonly opciones: { jwksUrl: string; emisor: string; audiencia: string; campoRol: string; timeoutMs?: number }) {
    const url = new URL(opciones.jwksUrl);
    if (!/^https?:$/.test(url.protocol) || !opciones.emisor || !opciones.audiencia || !opciones.campoRol) throw new Error("Configuración JWT incompleta o inválida.");
  }
  async validar(token: string): Promise<ActorJWT> {
    const partes = token.split(".");
    if (partes.length !== 3) throw new Error("Token inválido.");
    let cabecera: { alg?: string; kid?: string }; let payload: PayloadJWT; let firma: Buffer;
    try { cabecera = JSON.parse(Buffer.from(partes[0], "base64url").toString("utf8")); payload = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8")); firma = Buffer.from(partes[2], "base64url"); }
    catch { throw new Error("Token inválido."); }
    if (cabecera.alg !== "RS256" || !cabecera.kid) throw new Error("Algoritmo JWT no permitido.");
    const clave = await this.obtenerClave(cabecera.kid);
    const llave = createPublicKey({ key: clave as unknown as import("node:crypto").JsonWebKey, format: "jwk" });
    if (!verificarFirma("RSA-SHA256", Buffer.from(`${partes[0]}.${partes[1]}`), llave, firma)) throw new Error("Firma JWT inválida.");
    const ahora = Math.floor(Date.now() / 1000);
    const audiencia = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== this.opciones.emisor || !audiencia.includes(this.opciones.audiencia) || typeof payload.exp !== "number" || payload.exp <= ahora || (typeof payload.nbf === "number" && payload.nbf > ahora) || typeof payload.sub !== "string" || !payload.sub) throw new Error("Claims JWT inválidos o vencidos.");
    const valorRol = this.opciones.campoRol.split(".").reduce<unknown>((valor, parte) => typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>)[parte] : undefined, payload);
    const mapa: Record<string, RolJWT> = { pasajero: "PASAJERO", chofer: "CHOFER", soporte: "SOPORTE", administrador: "ADMINISTRADOR", admin: "ADMINISTRADOR" };
    const rol = typeof valorRol === "string" ? mapa[valorRol.toLowerCase()] : undefined;
    if (!rol) throw new Error("Claim de rol ausente o inválido.");
    return { idUsuario: payload.sub, rol };
  }
  private async obtenerClave(kid: string): Promise<ClaveJwk> {
    if (!this.claves || this.claves.vencimiento < Date.now()) {
      let respuesta: Response;
      try { respuesta = await fetch(this.opciones.jwksUrl, { signal: AbortSignal.timeout(this.opciones.timeoutMs ?? 1500) }); }
      catch { throw new Error("No se pudo consultar el proveedor JWT."); }
      if (!respuesta.ok) throw new Error("El proveedor JWT no está disponible.");
      const cuerpo = await respuesta.json() as { keys?: ClaveJwk[] };
      if (!Array.isArray(cuerpo.keys)) throw new Error("JWKS inválido.");
      this.claves = { claves: cuerpo.keys.filter((item) => item.kty === "RSA" && (!item.use || item.use === "sig") && (!item.alg || item.alg === "RS256")), vencimiento: Date.now() + 5 * 60_000 };
    }
    const clave = this.claves.claves.find((item) => item.kid === kid);
    if (!clave) { this.claves.vencimiento = 0; throw new Error("Clave JWT desconocida."); }
    return clave;
  }
}
