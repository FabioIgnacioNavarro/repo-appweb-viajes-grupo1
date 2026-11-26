import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { ValidadorJwtJwks } from "../../src/compartido/jwt";
import { crearAplicacionEmulador } from "../../src/emulador-auth/servidor";

async function iniciarServidor(): Promise<{ base: string; server: Server }> {
  const server = createServer(crearAplicacionEmulador());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No se pudo iniciar auth-emulator para la prueba.");
  return { base: `http://127.0.0.1:${address.port}`, server };
}

async function cerrarServidor(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

const contrasenaDemo = process.env.AUTH_DEMO_PASSWORD || "ViajesDemo2026!";

test("POST /auth/login emite JWT RS256 validable para las cuatro cuentas semilla", async () => {
  const { base, server } = await iniciarServidor();
  const cuentas = [
    { usuario: "ana", rol: "PASAJERO", id: "22222222-2222-4222-8222-222222222222" },
    { email: "carlos@viajes.local", rol: "CHOFER", id: "11111111-1111-4111-8111-111111111111" },
    { usuario: "lucia", rol: "SOPORTE", id: "44444444-4444-4444-8444-444444444444" },
    { usuario: "martin", rol: "ADMINISTRADOR", id: "99999999-9999-4999-8999-999999999999" }
  ];

  try {
    for (const cuenta of cuentas) {
      const respuesta = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: "usuario" in cuenta ? cuenta.usuario : undefined, email: "email" in cuenta ? cuenta.email : undefined, contrasena: contrasenaDemo })
      });
      assert.equal(respuesta.status, 200);
      assert.equal(respuesta.headers.get("cache-control"), "no-store");
      const datos = await respuesta.json() as {
        token: string;
        perfil: { id_usuario: string; rol: string; email: string; nombre: string };
        expira_en_segundos: number;
      };
      assert.equal(datos.perfil.id_usuario, cuenta.id);
      assert.equal(datos.perfil.rol.toUpperCase(), cuenta.rol);
      assert.match(datos.perfil.email, /@viajes\.local$/);
      assert.ok(datos.perfil.nombre);
      assert.equal(datos.expira_en_segundos, 3600);

      const claims = JSON.parse(Buffer.from(datos.token.split(".")[1]!, "base64url").toString("utf8")) as {
        iss: string;
        aud: string;
      };
      const validador = new ValidadorJwtJwks({
        jwksUrl: `${base}/.well-known/jwks.json`,
        emisor: claims.iss,
        audiencia: claims.aud,
        campoRol: "rol"
      });
      const actor = await validador.validar(datos.token);
      assert.equal(actor.idUsuario, cuenta.id);
      assert.equal(actor.rol, cuenta.rol);
    }
  } finally {
    await cerrarServidor(server);
  }
});

test("POST /auth/login usa el mismo error 401 para usuario inexistente y contraseña incorrecta", async () => {
  const { base, server } = await iniciarServidor();
  try {
    const respuestas = await Promise.all([
      fetch(`${base}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: "ana", contrasena: "incorrecta" })
      }),
      fetch(`${base}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: "desconocido", contrasena: contrasenaDemo })
      })
    ]);
    const cuerpos = await Promise.all(respuestas.map(async (respuesta) => ({
      status: respuesta.status,
      cuerpo: await respuesta.json() as { error: { codigo: string; mensaje: string; detalles: object } }
    })));
    assert.deepEqual(cuerpos.map((r) => r.status), [401, 401]);
    assert.deepEqual(cuerpos[0]!.cuerpo, cuerpos[1]!.cuerpo);
    assert.equal(cuerpos[0]!.cuerpo.error.codigo, "CREDENCIALES_INVALIDAS");
    assert.equal(cuerpos[0]!.cuerpo.error.detalles && Object.keys(cuerpos[0]!.cuerpo.error.detalles).length, 0);
  } finally {
    await cerrarServidor(server);
  }
});

test("POST /auth/login rechaza entradas inválidas y cuerpos mayores a 10kb", async () => {
  const { base, server } = await iniciarServidor();
  try {
    const vacia = await fetch(`${base}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: "ana" })
    });
    assert.equal(vacia.status, 400);
    assert.equal((await vacia.json() as { error: { codigo: string } }).error.codigo, "ENTRADA_INVALIDA");

    const jsonMalformado = await fetch(`${base}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{invalido"
    });
    assert.equal(jsonMalformado.status, 400);
    assert.equal((await jsonMalformado.json() as { error: { codigo: string } }).error.codigo, "ENTRADA_INVALIDA");

    const grande = await fetch(`${base}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: "ana", contrasena: "x".repeat(11 * 1024) })
    });
    assert.equal(grande.status, 413);
    assert.equal((await grande.json() as { error: { codigo: string } }).error.codigo, "PAYLOAD_DEMASIADO_GRANDE");
  } finally {
    await cerrarServidor(server);
  }
});

test("POST /auth/login está deshabilitado en producción", async () => {
  const { base, server } = await iniciarServidor();
  const ambienteAnterior = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const respuesta = await fetch(`${base}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: "ana", contrasena: contrasenaDemo })
    });
    assert.equal(respuesta.status, 404);
    assert.equal((await respuesta.json() as { error: { codigo: string } }).error.codigo, "RUTA_NO_ENCONTRADA");
  } finally {
    if (ambienteAnterior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ambienteAnterior;
    await cerrarServidor(server);
  }
});

test("POST /auth/registro crea pasajero/chofer, permite login posterior y bloquea roles privilegiados", async () => {
  const { base, server } = await iniciarServidor();
  try {
    const registro = await fetch(`${base}/auth/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: "laura.chofer", nombre: "Laura Chofer", contrasena: "ClaveSegura2026!", rol: "chofer" })
    });
    assert.equal(registro.status, 201);
    const cuerpoReg = await registro.json() as { token: string; perfil: { usuario: string; rol: string } };
    assert.equal(cuerpoReg.perfil.usuario, "laura.chofer");
    assert.equal(cuerpoReg.perfil.rol, "chofer");
    assert.ok(cuerpoReg.token);

    const duplicado = await fetch(`${base}/auth/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: "laura.chofer", contrasena: "ClaveSegura2026!", rol: "pasajero" })
    });
    assert.equal(duplicado.status, 409);

    const adminProhibido = await fetch(`${base}/auth/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: "intruso", contrasena: "ClaveSegura2026!", rol: "administrador" })
    });
    assert.equal(adminProhibido.status, 403);

    const loginNuevo = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: "laura.chofer", contrasena: "ClaveSegura2026!" })
    });
    assert.equal(loginNuevo.status, 200);
  } finally {
    await cerrarServidor(server);
  }
});
