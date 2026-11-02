import {
  generateKeyPairSync,
  sign as firmarCripto,
  type JsonWebKey,
  type KeyObject
} from "node:crypto";

export interface EmuladorClaves {
  clavePrivada: KeyObject;
  clavePublica: KeyObject;
  jwkPublica: JsonWebKey & { kid: string; alg: string; use: string };
  kid: string;
}

let instanciaClaves: EmuladorClaves | undefined;

export function obtenerOInicializarClaves(kid = "emulador-auth-v1"): EmuladorClaves {
  if (instanciaClaves && instanciaClaves.kid === kid) {
    return instanciaClaves;
  }
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001
  });
  const jwkExportada = publicKey.export({ format: "jwk" });
  const jwkPublica = {
    ...jwkExportada,
    kid,
    alg: "RS256",
    use: "sig"
  };
  instanciaClaves = {
    clavePrivada: privateKey,
    clavePublica: publicKey,
    jwkPublica,
    kid
  };
  return instanciaClaves;
}

export interface OpcionesTokenEmulador {
  emisor?: string;
  audiencia?: string;
  expiraEnSegundos?: number;
  adulterarFirma?: boolean;
  claveInvalida?: boolean;
  customClaims?: Record<string, unknown>;
}

export function emitirTokenJwt(
  idUsuario: string,
  rol: "pasajero" | "chofer" | "administrador" | "soporte",
  opciones: OpcionesTokenEmulador = {}
): string {
  const claves = obtenerOInicializarClaves();
  const ahora = Math.floor(Date.now() / 1000);
  const duracion = opciones.expiraEnSegundos ?? 3600;
  const emisor = opciones.emisor ?? "http://auth-emulator:9099/demo-viajes-grupo1";
  const audiencia = opciones.audiencia ?? "demo-viajes-grupo1";

  const cabecera = {
    alg: "RS256",
    typ: "JWT",
    kid: opciones.claveInvalida ? "clave-inexistente" : claves.kid
  };

  const payload = {
    sub: idUsuario,
    iss: emisor,
    aud: audiencia,
    iat: ahora,
    nbf: ahora - 10,
    exp: ahora + duracion,
    rol,
    ...opciones.customClaims
  };

  const cabeceraB64 = Buffer.from(JSON.stringify(cabecera), "utf8").toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const datosAFirmar = Buffer.from(`${cabeceraB64}.${payloadB64}`);

  const firma = firmarCripto("RSA-SHA256", datosAFirmar, claves.clavePrivada);
  let firmaB64 = firma.toString("base64url");

  if (opciones.adulterarFirma) {
    const corrompido = Buffer.from(firma);
    corrompido[0] = (corrompido[0] ?? 0) ^ 0xff;
    firmaB64 = corrompido.toString("base64url");
  }

  return `${cabeceraB64}.${payloadB64}.${firmaB64}`;
}

export const ACTORES_DEMO = {
  pasajero: {
    idUsuario: "22222222-2222-4222-8222-222222222222",
    rol: "pasajero" as const
  },
  chofer: {
    idUsuario: "11111111-1111-4111-8111-111111111111",
    rol: "chofer" as const
  },
  administrador: {
    idUsuario: "99999999-9999-4999-8999-999999999999",
    rol: "administrador" as const
  }
};

export function generarTokensDemostracion(emisor?: string, audiencia?: string) {
  const opts = { emisor, audiencia };
  return {
    pasajeroValido: emitirTokenJwt(ACTORES_DEMO.pasajero.idUsuario, ACTORES_DEMO.pasajero.rol, opts),
    choferValido: emitirTokenJwt(ACTORES_DEMO.chofer.idUsuario, ACTORES_DEMO.chofer.rol, opts),
    administradorValido: emitirTokenJwt(ACTORES_DEMO.administrador.idUsuario, ACTORES_DEMO.administrador.rol, opts),
    tokenExpirado: emitirTokenJwt(ACTORES_DEMO.pasajero.idUsuario, ACTORES_DEMO.pasajero.rol, {
      ...opts,
      expiraEnSegundos: -3600
    }),
    tokenFirmaAdulterada: emitirTokenJwt(ACTORES_DEMO.pasajero.idUsuario, ACTORES_DEMO.pasajero.rol, {
      ...opts,
      adulterarFirma: true
    })
  };
}
