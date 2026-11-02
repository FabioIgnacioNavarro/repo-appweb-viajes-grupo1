import "dotenv/config";
import express from "express";
import {
  ACTORES_DEMO,
  emitirTokenJwt,
  generarTokensDemostracion,
  obtenerOInicializarClaves
} from "./claves";

const puerto = Number(process.env.PUERTO_EMULADOR_AUTH ?? 9099);
const emisor = process.env.JWT_ISSUER ?? `http://auth-emulator:${puerto}/demo-viajes-grupo1`;
const audiencia = process.env.JWT_AUDIENCE ?? "demo-viajes-grupo1";

export function crearAplicacionEmulador() {
  const app = express();
  app.use(express.json());

  // Inicializa las claves RSA al arrancar
  const claves = obtenerOInicializarClaves();

  app.get("/health", (_req, res) => {
    res.status(200).json({ estado: "activo", servicio: "auth-emulator", kid: claves.kid });
  });

  // 1. Endpoint estándar JWKS (usado por microservicios y OIDC)
  app.get("/.well-known/jwks.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json({
      keys: [claves.jwkPublica]
    });
  });

  // 2. Endpoint compatible con Firebase Auth Emulator
  app.get("/emulator/v1/projects/:projectId/keys", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json({
      keys: [claves.jwkPublica]
    });
  });

  // 3. Endpoint auxiliar para obtener tokens listos para demostración
  app.get("/auth/tokens-demo", (_req, res) => {
    const tokens = generarTokensDemostracion(emisor, audiencia);
    res.status(200).json({
      actores: ACTORES_DEMO,
      emisor,
      audiencia,
      tokens
    });
  });

  // 4. Endpoint para emitir tokens dinámicos bajo demanda
  app.post("/auth/token", (req, res) => {
    const cuerpo = req.body ?? {};
    const idUsuario = typeof cuerpo.id_usuario === "string" && cuerpo.id_usuario.trim()
      ? cuerpo.id_usuario.trim()
      : ACTORES_DEMO.pasajero.idUsuario;
    const rolRaw = typeof cuerpo.rol === "string" ? cuerpo.rol.toLowerCase().trim() : "pasajero";
    const rolValido = ["pasajero", "chofer", "administrador", "soporte"].includes(rolRaw)
      ? (rolRaw as "pasajero" | "chofer" | "administrador" | "soporte")
      : "pasajero";

    const expiraEnSegundos = typeof cuerpo.expira_en_segundos === "number"
      ? cuerpo.expira_en_segundos
      : 3600;
    const adulterarFirma = Boolean(cuerpo.adulterar_firma);
    const customClaims = typeof cuerpo.custom_claims === "object" && cuerpo.custom_claims !== null
      ? (cuerpo.custom_claims as Record<string, unknown>)
      : undefined;

    const token = emitirTokenJwt(idUsuario, rolValido, {
      emisor,
      audiencia,
      expiraEnSegundos,
      adulterarFirma,
      customClaims
    });

    res.status(200).json({
      token,
      id_usuario: idUsuario,
      rol: rolValido,
      expira_en_segundos: expiraEnSegundos,
      adulterado: adulterarFirma
    });
  });

  return app;
}

if (typeof require !== "undefined" && require.main === module) {
  const app = crearAplicacionEmulador();
  const servidor = app.listen(puerto, () => {
    console.log(`[auth-emulator] Servidor de identidad y JWKS disponible en puerto ${puerto}`);
    console.log(`[auth-emulator] Endpoint JWKS: http://localhost:${puerto}/.well-known/jwks.json`);
  });
  const cerrar = () => { servidor.close(() => process.exit(0)); };
  process.once("SIGTERM", cerrar);
  process.once("SIGINT", cerrar);
}
