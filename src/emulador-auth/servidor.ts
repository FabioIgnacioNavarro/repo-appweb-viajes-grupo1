import "dotenv/config";
import { scrypt, timingSafeEqual } from "node:crypto";
import express from "express";
import { manejarErrorCuerpoHttp } from "../compartido/seguridad-http";
import {
  ACTORES_DEMO,
  emitirTokenJwt,
  generarTokensDemostracion,
  obtenerOInicializarClaves
} from "./claves";

const puerto = Number(process.env.PUERTO_EMULADOR_AUTH ?? 9099);
const emisor = process.env.JWT_ISSUER ?? `http://auth-emulator:${puerto}/demo-viajes-grupo1`;
const audiencia = process.env.JWT_AUDIENCE ?? "demo-viajes-grupo1";
const SAL_DEMO = "viajes-grupo1-auth-emulator-v1";
const CONTRASENA_DEMO_PREDETERMINADA = "ViajesDemo2026!";

const USUARIOS_SEMILLA = [
  { usuario: "ana", email: "ana@viajes.local", idUsuario: "22222222-2222-4222-8222-222222222222", rol: "pasajero" as const, nombre: "Ana Gómez" },
  { usuario: "carlos", email: "carlos@viajes.local", idUsuario: "11111111-1111-4111-8111-111111111111", rol: "chofer" as const, nombre: "Carlos Maidana" },
  { usuario: "lucia", email: "lucia@viajes.local", idUsuario: "44444444-4444-4444-8444-444444444444", rol: "soporte" as const, nombre: "Lucía Operaciones" },
  { usuario: "martin", email: "martin@viajes.local", idUsuario: "99999999-9999-4999-8999-999999999999", rol: "administrador" as const, nombre: "Martín Administrador" }
];

function mismoHash(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function derivarHash(contrasena: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(contrasena, SAL_DEMO, 32, (error, derivado) => {
      if (error) reject(error);
      else resolve(derivado);
    });
  });
}

export function crearAplicacionEmulador() {
  const app = express();
  app.use(express.json({ limit: "10kb" }));
  app.use(manejarErrorCuerpoHttp);

  // Cuentas y clave compartida ficticias: solo para la demo local del emulador.
  // En producción no se ofrece autenticación con estos usuarios semilla.
  const claveDemo = process.env.AUTH_DEMO_PASSWORD || CONTRASENA_DEMO_PREDETERMINADA;
  const hashClaveDemo = derivarHash(claveDemo);
  const hashDesconocido = derivarHash(`${claveDemo}-usuario-inexistente`);

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

  app.post("/auth/login", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({
        error: {
          codigo: "RUTA_NO_ENCONTRADA",
          mensaje: "La ruta no existe o no está disponible en este entorno.",
          detalles: {}
        }
      });
      return;
    }

    const cuerpo = req.body;
    const usuarioRaw = typeof cuerpo?.usuario === "string"
      ? cuerpo.usuario.trim().toLowerCase()
      : typeof cuerpo?.email === "string"
        ? cuerpo.email.trim().toLowerCase()
        : "";
    const contrasena = typeof cuerpo?.contrasena === "string" ? cuerpo.contrasena : "";
    if (!usuarioRaw || !contrasena || contrasena.length > 256) {
      res.status(400).json({
        error: {
          codigo: "ENTRADA_INVALIDA",
          mensaje: "Ingresá un usuario y una contraseña válidos.",
          detalles: {}
        }
      });
      return;
    }

    const cuenta = USUARIOS_SEMILLA.find((semilla) => semilla.usuario === usuarioRaw || semilla.email === usuarioRaw);
    const [hashPresentado, hashValido, hashInvalido] = await Promise.all([
      derivarHash(contrasena),
      hashClaveDemo,
      hashDesconocido
    ]);
    const claveCorrecta = mismoHash(hashPresentado, cuenta ? hashValido : hashInvalido);
    if (!cuenta || !claveCorrecta) {
      res.status(401).json({
        error: {
          codigo: "CREDENCIALES_INVALIDAS",
          mensaje: "El usuario o la contraseña no son correctos.",
          detalles: {}
        }
      });
      return;
    }

    const token = emitirTokenJwt(cuenta.idUsuario, cuenta.rol, {
      emisor,
      audiencia,
      customClaims: { name: cuenta.nombre, email: cuenta.email }
    });
    res.status(200).json({
      token,
      perfil: {
        id_usuario: cuenta.idUsuario,
        usuario: cuenta.usuario,
        email: cuenta.email,
        nombre: cuenta.nombre,
        rol: cuenta.rol
      },
      expira_en_segundos: 3600
    });
  });

  // 4. Endpoint para emitir tokens dinámicos bajo demanda
  app.post("/auth/token", (req, res) => {
    const cuerpo = req.body ?? {};
    const idRaw = typeof cuerpo.id_usuario === "string" && cuerpo.id_usuario.trim()
      ? cuerpo.id_usuario
      : typeof cuerpo.idUsuario === "string" && cuerpo.idUsuario.trim()
        ? cuerpo.idUsuario
        : ACTORES_DEMO.pasajero.idUsuario;
    const idUsuario = idRaw.trim();
    const rolRaw = typeof cuerpo.rol === "string" ? cuerpo.rol.toLowerCase().trim() : "pasajero";
    const rolValido = ["pasajero", "chofer", "administrador", "soporte"].includes(rolRaw)
      ? (rolRaw as "pasajero" | "chofer" | "administrador" | "soporte")
      : "pasajero";

    const expiraEnSegundos = typeof cuerpo.expira_en_segundos === "number"
      ? cuerpo.expira_en_segundos
      : 3600;
    const adulterarFirma = Boolean(cuerpo.adulterar_firma);
    const claimsBase = typeof cuerpo.custom_claims === "object" && cuerpo.custom_claims !== null
      ? { ...(cuerpo.custom_claims as Record<string, unknown>) }
      : undefined;
    const nombreClaim = typeof cuerpo.nombre === "string" && cuerpo.nombre.trim() ? cuerpo.nombre.trim() : undefined;
    const customClaims = nombreClaim || claimsBase
      ? { ...(claimsBase ?? {}), ...(nombreClaim ? { name: nombreClaim } : {}) }
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
