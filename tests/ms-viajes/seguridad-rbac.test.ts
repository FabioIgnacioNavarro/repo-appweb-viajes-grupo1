import test from "node:test";
import { strict as assert } from "node:assert";
import express from "express";
import { createServer, type Server } from "node:http";
import { ValidadorJwtJwks } from "../../src/compartido/jwt";
import { crearAplicacionEmulador } from "../../src/emulador-auth/servidor";
import { emitirTokenJwt, ACTORES_DEMO } from "../../src/emulador-auth/claves";
import {
  AceptarOferta,
  AsignadorAtomicoMemoria,
  AvanzarViaje,
  CancelarViaje,
  ConfirmarViaje,
  ConsultarChoferesOcupados,
  ConsultarDemandaPorZona,
  ConsultarViaje,
  FinalizarViaje,
  GeneradorIdMemoria,
  RechazarOferta,
  RepositorioCobrosMemoria,
  RepositorioIdempotenciaMemoria,
  RepositorioOfertasMemoria,
  RepositorioViajesMemoria,
  type EstimacionVigente,
  type Oferta,
  type Viaje
} from "../../src/ms-viajes/dominio";
import { crearRouterViajes, type DependenciasViajes } from "../../src/ms-viajes/http";

interface EntornoPruebaRbac {
  authBase: string;
  viajesBase: string;
  authServidor: Server;
  viajesServidor: Server;
  deps: DependenciasViajes;
  estimacion: EstimacionVigente;
}

const EMISOR_TEST = "http://auth-emulator-test:9099/demo-viajes-grupo1";
const AUDIENCIA_TEST = "demo-viajes-grupo1";

async function levantarServidorHttp(app: express.Express): Promise<{ base: string; servidor: Server }> {
  const servidor = createServer(app);
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const direccion = servidor.address();
  if (!direccion || typeof direccion === "string") {
    throw new Error("No se pudo iniciar el servidor HTTP.");
  }
  return { base: `http://127.0.0.1:${direccion.port}`, servidor };
}

async function cerrarServidor(servidor: Server): Promise<void> {
  await new Promise<void>((resolver, rechazar) => {
    servidor.close((error) => (error ? rechazar(error) : resolver()));
  });
}

async function prepararEntornoRbac(): Promise<EntornoPruebaRbac> {
  // 1. Iniciar servidor Emulador Auth con JWKS
  const authApp = crearAplicacionEmulador();
  const { base: authBase, servidor: authServidor } = await levantarServidorHttp(authApp);

  // 2. Configurar ValidadorJwtJwks apuntando al emulador
  const validadorJwks = new ValidadorJwtJwks({
    jwksUrl: `${authBase}/.well-known/jwks.json`,
    emisor: EMISOR_TEST,
    audiencia: AUDIENCIA_TEST,
    campoRol: "rol"
  });

  // 3. Preparar dominio y dependencias de ms-viajes
  const viajes = new RepositorioViajesMemoria();
  const ofertas = new RepositorioOfertasMemoria();
  const cobros = new RepositorioCobrosMemoria();
  const ids = new GeneradorIdMemoria();
  const idempotencia = new RepositorioIdempotenciaMemoria();
  const asignador = new AsignadorAtomicoMemoria();

  const ahora = new Date();
  const estimacion: EstimacionVigente = {
    id: "estimacion-rbac-1",
    origen: { latitud: -27.451, longitud: -58.986 },
    destino: { latitud: -27.46, longitud: -58.99 },
    precioEstimado: "9500",
    moneda: "ARS",
    multiplicadorDemanda: 1.2,
    factoresPrecio: { zona_id: "resistencia", solicitudes_activas: 15, choferes_disponibles: 10 },
    creadaEn: ahora,
    vigenteHasta: new Date(ahora.getTime() + 300_000)
  };

  const deps: DependenciasViajes = {
    viajes,
    ofertas,
    confirmar: new ConfirmarViaje(viajes, idempotencia, ids),
    aceptar: new AceptarOferta(ofertas, viajes, asignador),
    rechazar: new RechazarOferta(ofertas),
    cancelar: new CancelarViaje(viajes, asignador),
    avanzar: new AvanzarViaje(viajes),
    finalizar: new FinalizarViaje(viajes, cobros, asignador, ids),
    consultar: new ConsultarViaje(viajes),
    validadorToken: validadorJwks,
    obtenerEstimacion: async (actor, id) => {
      // Solo el pasajero dueño de la estimación o soporte/admin puede obtenerla
      if (actor.rol === "PASAJERO" || actor.rol === "ADMINISTRADOR") {
        return estimacion.id === id ? estimacion : undefined;
      }
      return undefined;
    },
    consultarDemanda: new ConsultarDemandaPorZona(viajes),
    consultarOcupacion: new ConsultarChoferesOcupados(viajes)
  };

  // 4. Iniciar router y servidor de ms-viajes
  const viajesApp = express();
  viajesApp.use(crearRouterViajes(deps));
  const { base: viajesBase, servidor: viajesServidor } = await levantarServidorHttp(viajesApp);

  return {
    authBase,
    viajesBase,
    authServidor,
    viajesServidor,
    deps,
    estimacion
  };
}

async function peticion(
  base: string,
  ruta: string,
  opciones: {
    metodo?: string;
    token?: string;
    cuerpo?: unknown;
    encabezados?: Record<string, string>;
  } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opciones.encabezados ?? {})
  };
  if (opciones.token) {
    headers["Authorization"] = `Bearer ${opciones.token}`;
  }

  const res = await fetch(`${base}${ruta}`, {
    method: opciones.metodo ?? "GET",
    headers,
    body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined
  });

  const texto = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(texto);
  } catch {
    json = { texto };
  }
  return { status: res.status, body: json };
}

test("SEG-002: Escenario 1 - Acceso Autorizado (200 / 201) con token legítimo RS256", async () => {
  const env = await prepararEntornoRbac();
  try {
    const tokenPasajero = emitirTokenJwt("usr-pasajero-1", "pasajero", {
      emisor: EMISOR_TEST,
      audiencia: AUDIENCIA_TEST
    });

    // 1. Confirmar viaje legítimamente como pasajero
    const resCrear = await peticion(env.viajesBase, "/viajes", {
      metodo: "POST",
      token: tokenPasajero,
      cuerpo: { id_estimacion: env.estimacion.id },
      encabezados: { "Clave-Idempotencia": "idem-rbac-101" }
    });

    assert.equal(resCrear.status, 201, "Debe crear el viaje con 201 Created");
    assert.equal(resCrear.body.pasajero_id, "usr-pasajero-1");
    assert.equal(resCrear.body.estado, "solicitado");
    const idViaje = resCrear.body.id_viaje;

    // 2. Consultar el viaje propio con token legítimo
    const resConsulta = await peticion(env.viajesBase, `/viajes/${idViaje}`, {
      metodo: "GET",
      token: tokenPasajero
    });
    assert.equal(resConsulta.status, 200, "El dueño del viaje debe recibir 200 OK");
    assert.equal(resConsulta.body.id_viaje, idViaje);

    // 3. Asignar chofer y avanzar el viaje legítimamente con token de chofer
    const viajeGuardado = await env.deps.viajes.obtener(idViaje);
    assert.ok(viajeGuardado);
    await env.deps.viajes.guardar({
      ...viajeGuardado,
      choferId: "usr-chofer-1",
      estado: "ASIGNADO"
    });

    const tokenChofer = emitirTokenJwt("usr-chofer-1", "chofer", {
      emisor: EMISOR_TEST,
      audiencia: AUDIENCIA_TEST
    });

    const resAvanzar = await peticion(env.viajesBase, `/viajes/${idViaje}/llegada`, {
      metodo: "POST",
      token: tokenChofer
    });
    assert.equal(resAvanzar.status, 200, "El chofer asignado debe poder avanzar el viaje con 200 OK");
    assert.equal(resAvanzar.body.estado, "chofer_en_camino");
  } finally {
    await cerrarServidor(env.viajesServidor);
    await cerrarServidor(env.authServidor);
  }
});

test("SEG-002: Escenario 2 - Acceso No Autenticado / Token Inválido (401 Unauthorized)", async () => {
  const env = await prepararEntornoRbac();
  try {
    // 1. Petición sin encabezado Authorization
    const resSinToken = await peticion(env.viajesBase, "/viajes", {
      metodo: "POST",
      cuerpo: { id_estimacion: env.estimacion.id },
      encabezados: { "Clave-Idempotencia": "idem-rbac-201" }
    });
    assert.equal(resSinToken.status, 401, "Sin token debe retornar 401");
    assert.equal(resSinToken.body.error.codigo, "TOKEN_REQUERIDO");

    // 2. Petición con token mal formado (no JWT)
    const resMalformado = await peticion(env.viajesBase, "/viajes", {
      metodo: "POST",
      token: "esto-no-es-un-jwt-valido",
      cuerpo: { id_estimacion: env.estimacion.id },
      encabezados: { "Clave-Idempotencia": "idem-rbac-202" }
    });
    assert.equal(resMalformado.status, 401, "Token malformado debe retornar 401");
    assert.equal(resMalformado.body.error.codigo, "TOKEN_INVALIDO");

    // 3. Petición con firma adulterada / manipulada (Ataque Criptográfico)
    const tokenAdulterado = emitirTokenJwt("usr-pasajero-1", "pasajero", {
      emisor: EMISOR_TEST,
      audiencia: AUDIENCIA_TEST,
      adulterarFirma: true
    });
    const resFirmaInvalida = await peticion(env.viajesBase, "/viajes", {
      metodo: "POST",
      token: tokenAdulterado,
      cuerpo: { id_estimacion: env.estimacion.id },
      encabezados: { "Clave-Idempotencia": "idem-rbac-203" }
    });
    assert.equal(resFirmaInvalida.status, 401, "Firma adulterada debe ser rechazada con 401");
    assert.equal(resFirmaInvalida.body.error.codigo, "TOKEN_INVALIDO");

    // 4. Petición con token expirado (exp vencido)
    const tokenExpirado = emitirTokenJwt("usr-pasajero-1", "pasajero", {
      emisor: EMISOR_TEST,
      audiencia: AUDIENCIA_TEST,
      expiraEnSegundos: -30
    });
    const resExpirado = await peticion(env.viajesBase, "/viajes", {
      metodo: "POST",
      token: tokenExpirado,
      cuerpo: { id_estimacion: env.estimacion.id },
      encabezados: { "Clave-Idempotencia": "idem-rbac-204" }
    });
    assert.equal(resExpirado.status, 401, "Token vencido debe retornar 401");
    assert.equal(resExpirado.body.error.codigo, "TOKEN_INVALIDO");

    // 5. Petición con clave no existente en JWKS (kid desconocido)
    const tokenClaveInvalida = emitirTokenJwt("usr-pasajero-1", "pasajero", {
      emisor: EMISOR_TEST,
      audiencia: AUDIENCIA_TEST,
      claveInvalida: true
    });
    const resClaveInvalida = await peticion(env.viajesBase, "/viajes", {
      metodo: "POST",
      token: tokenClaveInvalida,
      cuerpo: { id_estimacion: env.estimacion.id },
      encabezados: { "Clave-Idempotencia": "idem-rbac-205" }
    });
    assert.equal(resClaveInvalida.status, 401, "Kid desconocido debe retornar 401");
    assert.equal(resClaveInvalida.body.error.codigo, "TOKEN_INVALIDO");

    // 6. Petición con emisor incorrecto
    const tokenEmisorInvalido = emitirTokenJwt("usr-pasajero-1", "pasajero", {
      emisor: "https://atacante-malicioso.com",
      audiencia: AUDIENCIA_TEST
    });
    const resEmisorInvalido = await peticion(env.viajesBase, "/viajes", {
      metodo: "POST",
      token: tokenEmisorInvalido,
      cuerpo: { id_estimacion: env.estimacion.id },
      encabezados: { "Clave-Idempotencia": "idem-rbac-206" }
    });
    assert.equal(resEmisorInvalido.status, 401, "Emisor ajeno debe retornar 401");
    assert.equal(resEmisorInvalido.body.error.codigo, "TOKEN_INVALIDO");
  } finally {
    await cerrarServidor(env.viajesServidor);
    await cerrarServidor(env.authServidor);
  }
});

test("SEG-002: Escenario 3 - Acceso No Autorizado / RBAC y Usurpación de Recurso (403 Forbidden)", async () => {
  const env = await prepararEntornoRbac();
  try {
    const tokenPasajeroA = emitirTokenJwt("usr-pasajero-A", "pasajero", {
      emisor: EMISOR_TEST,
      audiencia: AUDIENCIA_TEST
    });
    const tokenPasajeroB = emitirTokenJwt("usr-pasajero-B", "pasajero", {
      emisor: EMISOR_TEST,
      audiencia: AUDIENCIA_TEST
    });
    const tokenChoferA = emitirTokenJwt("usr-chofer-A", "chofer", {
      emisor: EMISOR_TEST,
      audiencia: AUDIENCIA_TEST
    });
    const tokenChoferB = emitirTokenJwt("usr-chofer-B", "chofer", {
      emisor: EMISOR_TEST,
      audiencia: AUDIENCIA_TEST
    });
    const tokenAdmin = emitirTokenJwt("usr-admin-1", "administrador", {
      emisor: EMISOR_TEST,
      audiencia: AUDIENCIA_TEST
    });

    // Crear un viaje legítimo perteneciente al Pasajero A
    const resCrear = await peticion(env.viajesBase, "/viajes", {
      metodo: "POST",
      token: tokenPasajeroA,
      cuerpo: { id_estimacion: env.estimacion.id },
      encabezados: { "Clave-Idempotencia": "idem-rbac-301" }
    });
    assert.equal(resCrear.status, 201);
    const idViaje = resCrear.body.id_viaje;

    // Asignar el viaje a Chofer A
    const viajeGuardado = await env.deps.viajes.obtener(idViaje);
    assert.ok(viajeGuardado);
    await env.deps.viajes.guardar({
      ...viajeGuardado,
      choferId: "usr-chofer-A",
      estado: "ASIGNADO"
    });

    // 1. Violación RBAC: Un Pasajero intenta aceptar una oferta (endpoint exclusivo de CHOFER)
    // Se inserta una oferta ficticia para probar la denegación por rol
    const ahora = new Date();
    const ofertaPrueba: Oferta = {
      id: "oferta-rbac-1",
      viajeId: idViaje,
      choferId: "usr-chofer-A",
      estado: "PENDIENTE",
      enviadaEm: ahora,
      expiraEm: new Date(ahora.getTime() + 60_000)
    };
    await env.deps.ofertas.guardar(ofertaPrueba);

    const resAceptarPasajero = await peticion(env.viajesBase, `/choferes/yo/ofertas/${ofertaPrueba.id}/aceptacion`, {
      metodo: "POST",
      token: tokenPasajeroA
    });
    assert.equal(resAceptarPasajero.status, 403, "Pasajero no debe poder invocar endpoint de chofer (403)");
    assert.equal(resAceptarPasajero.body.error.codigo, "ROL_NO_AUTORIZADO");

    // 2. Violación de Recurso: Pasajero B intenta consultar el viaje de Pasajero A
    const resConsultaAjena = await peticion(env.viajesBase, `/viajes/${idViaje}`, {
      metodo: "GET",
      token: tokenPasajeroB
    });
    assert.equal(resConsultaAjena.status, 403, "Pasajero ajeno no debe poder consultar el viaje (403)");
    assert.equal(resConsultaAjena.body.error.codigo, "VIAJE_NO_AUTORIZADO");

    // 3. Violación de Recurso Chofer: Chofer B intenta marcar llegada en viaje asignado a Chofer A
    const resLlegadaChoferAjeno = await peticion(env.viajesBase, `/viajes/${idViaje}/llegada`, {
      metodo: "POST",
      token: tokenChoferB
    });
    assert.equal(resLlegadaChoferAjeno.status, 403, "Chofer ajeno no debe poder avanzar viaje ajeno (403)");
    assert.equal(resLlegadaChoferAjeno.body.error.codigo, "VIAJE_NO_AUTORIZADO");

    // 4. Auditoría autorizada: Un Administrador sí puede auditar el viaje ajeno
    const resConsultaAdmin = await peticion(env.viajesBase, `/viajes/${idViaje}`, {
      metodo: "GET",
      token: tokenAdmin
    });
    assert.equal(resConsultaAdmin.status, 200, "Administrador tiene permiso de auditoría (200 OK)");
    assert.equal(resConsultaAdmin.body.id_viaje, idViaje);
  } finally {
    await cerrarServidor(env.viajesServidor);
    await cerrarServidor(env.authServidor);
  }
});
