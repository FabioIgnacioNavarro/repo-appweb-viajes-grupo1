import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { ValidadorJwtJwks } from "./jwt";
import { crearAplicacionEmulador } from "../emulador-auth/servidor";
import { emitirTokenJwt } from "../emulador-auth/claves";

async function iniciarServidorEmulador(): Promise<{ base: string; server: Server }> {
  const app = crearAplicacionEmulador();
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Sin dirección de test.");
  return { base: `http://127.0.0.1:${address.port}`, server };
}

async function cerrarServidor(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

test("ValidadorJwtJwks valida tokens RS256 firmados por el emulador para cada rol", async () => {
  const { base, server } = await iniciarServidorEmulador();
  const emisor = `${base}/demo-viajes-grupo1`;
  const audiencia = "demo-viajes-grupo1";

  try {
    const validador = new ValidadorJwtJwks({
      jwksUrl: `${base}/.well-known/jwks.json`,
      emisor,
      audiencia,
      campoRol: "rol"
    });

    const tokenPasajero = emitirTokenJwt("usr-pasajero-1", "pasajero", { emisor, audiencia });
    const actorPasajero = await validador.validar(tokenPasajero);
    assert.equal(actorPasajero.idUsuario, "usr-pasajero-1");
    assert.equal(actorPasajero.rol, "PASAJERO");

    const tokenChofer = emitirTokenJwt("usr-chofer-1", "chofer", { emisor, audiencia });
    const actorChofer = await validador.validar(tokenChofer);
    assert.equal(actorChofer.idUsuario, "usr-chofer-1");
    assert.equal(actorChofer.rol, "CHOFER");

    const tokenAdmin = emitirTokenJwt("usr-admin-1", "administrador", { emisor, audiencia });
    const actorAdmin = await validador.validar(tokenAdmin);
    assert.equal(actorAdmin.idUsuario, "usr-admin-1");
    assert.equal(actorAdmin.rol, "ADMINISTRADOR");
  } finally {
    await cerrarServidor(server);
  }
});

test("ValidadorJwtJwks rechaza token con firma adulterada", async () => {
  const { base, server } = await iniciarServidorEmulador();
  const emisor = `${base}/demo-viajes-grupo1`;
  const audiencia = "demo-viajes-grupo1";

  try {
    const validador = new ValidadorJwtJwks({
      jwksUrl: `${base}/.well-known/jwks.json`,
      emisor,
      audiencia,
      campoRol: "rol"
    });

    const tokenAdulterado = emitirTokenJwt("usr-atacante", "pasajero", {
      emisor,
      audiencia,
      adulterarFirma: true
    });

    await assert.rejects(
      () => validador.validar(tokenAdulterado),
      (err: Error) => err.message.includes("Firma JWT inválida")
    );
  } finally {
    await cerrarServidor(server);
  }
});

test("ValidadorJwtJwks rechaza token expirado", async () => {
  const { base, server } = await iniciarServidorEmulador();
  const emisor = `${base}/demo-viajes-grupo1`;
  const audiencia = "demo-viajes-grupo1";

  try {
    const validador = new ValidadorJwtJwks({
      jwksUrl: `${base}/.well-known/jwks.json`,
      emisor,
      audiencia,
      campoRol: "rol"
    });

    const tokenExpirado = emitirTokenJwt("usr-vencido", "pasajero", {
      emisor,
      audiencia,
      expiraEnSegundos: -120
    });

    await assert.rejects(
      () => validador.validar(tokenExpirado),
      (err: Error) => err.message.includes("Claims JWT inválidos o vencidos")
    );
  } finally {
    await cerrarServidor(server);
  }
});

test("ValidadorJwtJwks rechaza emisor o audiencia incorrectos", async () => {
  const { base, server } = await iniciarServidorEmulador();
  const emisor = `${base}/demo-viajes-grupo1`;
  const audiencia = "demo-viajes-grupo1";

  try {
    const validador = new ValidadorJwtJwks({
      jwksUrl: `${base}/.well-known/jwks.json`,
      emisor,
      audiencia,
      campoRol: "rol"
    });

    const tokenOtroEmisor = emitirTokenJwt("usr-1", "pasajero", {
      emisor: "http://otro-emisor.com",
      audiencia
    });
    await assert.rejects(() => validador.validar(tokenOtroEmisor));

    const tokenOtraAudiencia = emitirTokenJwt("usr-1", "pasajero", {
      emisor,
      audiencia: "otra-audiencia"
    });
    await assert.rejects(() => validador.validar(tokenOtraAudiencia));
  } finally {
    await cerrarServidor(server);
  }
});

test("ValidadorJwtJwks soporta custom claims anidados estilo Firebase", async () => {
  const { base, server } = await iniciarServidorEmulador();
  const emisor = `${base}/demo-viajes-grupo1`;
  const audiencia = "demo-viajes-grupo1";

  try {
    const validador = new ValidadorJwtJwks({
      jwksUrl: `${base}/.well-known/jwks.json`,
      emisor,
      audiencia,
      campoRol: "claims.perfil.rol"
    });

    const tokenAnidado = emitirTokenJwt("usr-firebase", "chofer", {
      emisor,
      audiencia,
      customClaims: {
        claims: {
          perfil: {
            rol: "chofer"
          }
        }
      }
    });

    const actor = await validador.validar(tokenAnidado);
    assert.equal(actor.idUsuario, "usr-firebase");
    assert.equal(actor.rol, "CHOFER");
  } finally {
    await cerrarServidor(server);
  }
});

test("ValidadorJwtJwks rechaza clave desconocida (kid no registrado en JWKS)", async () => {
  const { base, server } = await iniciarServidorEmulador();
  const emisor = `${base}/demo-viajes-grupo1`;
  const audiencia = "demo-viajes-grupo1";

  try {
    const validador = new ValidadorJwtJwks({
      jwksUrl: `${base}/.well-known/jwks.json`,
      emisor,
      audiencia,
      campoRol: "rol"
    });

    const tokenClaveInexistente = emitirTokenJwt("usr-1", "pasajero", {
      emisor,
      audiencia,
      claveInvalida: true
    });

    await assert.rejects(
      () => validador.validar(tokenClaveInexistente),
      (err: Error) => err.message.includes("Clave JWT desconocida")
    );
  } finally {
    await cerrarServidor(server);
  }
});
