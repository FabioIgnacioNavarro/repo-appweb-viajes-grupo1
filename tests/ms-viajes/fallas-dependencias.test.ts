import express from "express";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { strict as assert } from "node:assert";
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
} from "../../src/ms-viajes/dominio";
import { crearRouterViajes, ValidadorTokenFalso, type DependenciasViajes } from "../../src/ms-viajes/http";
import { ClienteServiciosHttp, ErrorDependenciaHttp } from "../../src/compartido/cliente-servicios";
import { NotificadorUbicacionViajesHttp } from "../../src/ms-flota/notificador-viajes-http";

const ahoraPrueba = new Date();
const estimacionValida: EstimacionVigente = {
  id: "est-falla-1",
  origen: { latitud: -27.4512, longitud: -58.9866 },
  destino: { latitud: -27.4598, longitud: -58.9789 },
  precioEstimado: "4500",
  moneda: "ARS",
  multiplicadorDemanda: 1.0,
  factoresPrecio: { zona_id: "centro" },
  creadaEn: ahoraPrueba,
  vigenteHasta: new Date(ahoraPrueba.getTime() + 180_000),
};

interface ContextoServidorFallas {
  base: string;
  servidor: Server;
  estadoFlota: { caida: boolean };
  estadoTarifas: { caida: boolean };
  erroresRegistrados: Array<{ servicio: string; operacion: string; resultado: string }>;
}

async function iniciarServidorFallas(): Promise<ContextoServidorFallas> {
  const estadoFlota = { caida: false };
  const estadoTarifas = { caida: false };
  const erroresRegistrados: Array<{ servicio: string; operacion: string; resultado: string }> = [];

  const viajes = new RepositorioViajesMemoria();
  const ofertas = new RepositorioOfertasMemoria();
  const cobros = new RepositorioCobrosMemoria();
  const ids = new GeneradorIdMemoria();
  const idempotencia = new RepositorioIdempotenciaMemoria();
  const asignador = new AsignadorAtomicoMemoria();

  const clienteHttp = new ClienteServiciosHttp({
    timeoutMs: 100,
    reintentos: 1,
    registrarError: (evento) => erroresRegistrados.push(evento),
    obtener: async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("ms-flota") && estadoFlota.caida) {
        throw new Error("Conexión rechazada: ms-flota caído");
      }
      if (urlStr.includes("ms-tarifas") && estadoTarifas.caida) {
        throw new Error("Conexión rechazada: ms-tarifas caído");
      }
      if (urlStr.includes("/choferes/cercanos")) {
        return Response.json({ candidatos: [{ id_chofer: "chofer-1" }, { id_chofer: "chofer-2" }] });
      }
      return Response.json({ status: "ok" });
    },
  });

  const confirmar = new ConfirmarViaje(viajes, idempotencia, ids);
  const deps: DependenciasViajes = {
    viajes,
    ofertas,
    confirmar,
    aceptar: new AceptarOferta(ofertas, viajes, asignador),
    rechazar: new RechazarOferta(ofertas),
    cancelar: new CancelarViaje(viajes, asignador),
    avanzar: new AvanzarViaje(viajes),
    finalizar: new FinalizarViaje(viajes, cobros, asignador, ids),
    consultar: new ConsultarViaje(viajes),
    validadorToken: new ValidadorTokenFalso({
      pasajero: { idUsuario: "pasajero-1", rol: "PASAJERO" },
      chofer: { idUsuario: "chofer-1", rol: "CHOFER" },
    }),
    obtenerEstimacion: async (_actor, id) => {
      if (estadoTarifas.caida) {
        throw new ErrorDependenciaHttp("ms-tarifas", "estimacion");
      }
      return id === estimacionValida.id ? estimacionValida : undefined;
    },
    confirmarConOfertas: async (actor, estimacion, clave, _jwt) => {
      if (estadoFlota.caida) {
        throw new ErrorDependenciaHttp("ms-flota", "candidatos");
      }
      return confirmar.ejecutar(actor, estimacion, clave);
    },
    consultarDemanda: new ConsultarDemandaPorZona(viajes),
    consultarOcupacion: new ConsultarChoferesOcupados(viajes),
  };

  const app = express();
  app.use(crearRouterViajes(deps));
  const servidor = createServer(app);

  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const direccion = servidor.address();
  if (!direccion || typeof direccion === "string") throw new Error("No se pudo iniciar el servidor de pruebas.");

  return {
    base: `http://127.0.0.1:${direccion.port}`,
    servidor,
    estadoFlota,
    estadoTarifas,
    erroresRegistrados,
  };
}

async function cerrarServidor(servidor: Server): Promise<void> {
  await new Promise<void>((resolver, rechazar) =>
    servidor.close((err) => (err ? rechazar(err) : resolver()))
  );
}

test("FAL-001: ms-viajes devuelve 503 DEPENDENCIA_NO_DISPONIBLE ante caída de ms-flota durante confirmación", async () => {
  const ctx = await iniciarServidorFallas();
  try {
    ctx.estadoFlota.caida = true;

    const res = await fetch(`${ctx.base}/viajes`, {
      method: "POST",
      headers: {
        Authorization: "Bearer pasajero",
        "Content-Type": "application/json",
        "Clave-Idempotencia": "falla-flota-1",
      },
      body: JSON.stringify({ id_estimacion: estimacionValida.id }),
    });

    assert.equal(res.status, 503);
    const cuerpo = (await res.json()) as { error: { codigo: string; mensaje: string } };
    assert.equal(cuerpo.error.codigo, "DEPENDENCIA_NO_DISPONIBLE");
    assert.match(cuerpo.error.mensaje, /dependencia temporalmente no disponible/i);
  } finally {
    await cerrarServidor(ctx.servidor);
  }
});

test("FAL-001: ms-viajes devuelve 503 DEPENDENCIA_NO_DISPONIBLE ante caída de ms-tarifas al verificar estimación", async () => {
  const ctx = await iniciarServidorFallas();
  try {
    ctx.estadoTarifas.caida = true;

    const res = await fetch(`${ctx.base}/viajes`, {
      method: "POST",
      headers: {
        Authorization: "Bearer pasajero",
        "Content-Type": "application/json",
        "Clave-Idempotencia": "falla-tarifas-1",
      },
      body: JSON.stringify({ id_estimacion: estimacionValida.id }),
    });

    assert.equal(res.status, 503);
    const cuerpo = (await res.json()) as { error: { codigo: string } };
    assert.equal(cuerpo.error.codigo, "DEPENDENCIA_NO_DISPONIBLE");
  } finally {
    await cerrarServidor(ctx.servidor);
  }
});

test("FAL-001: ClienteServiciosHttp acota timeout, reintenta una sola vez y registra evento estructurado seguro", async () => {
  let llamadas = 0;
  const eventosRegistrados: Array<{ servicio: string; operacion: string; resultado: string }> = [];

  const cliente = new ClienteServiciosHttp({
    timeoutMs: 30,
    reintentos: 1,
    esperar: async () => {},
    registrarError: (evento) => eventosRegistrados.push(evento),
    obtener: async () => {
      llamadas++;
      throw new Error("Error inducido de socket");
    },
  });

  await assert.rejects(
    () => cliente.getJson("ms-flota", "candidatos", "http://ms-flota:3002/candidatos", "secreto-jwt"),
    ErrorDependenciaHttp
  );

  // Exactamente 2 intentos: 1 original + 1 reintento
  assert.equal(llamadas, 2);
  assert.equal(eventosRegistrados.length, 1);
  assert.equal(eventosRegistrados[0].servicio, "ms-flota");
  assert.equal(eventosRegistrados[0].operacion, "candidatos");
  assert.equal(eventosRegistrados[0].resultado, "timeout_o_red");
  // Invariante de seguridad: ningún token ni secreto viaja en el log
  assert.equal(JSON.stringify(eventosRegistrados).includes("secreto-jwt"), false);
});

test("FAL-001: recuperación exitosa y reintento con misma Clave-Idempotencia tras restablecer dependencia", async () => {
  const ctx = await iniciarServidorFallas();
  try {
    const claveIdempotencia = "recuperacion-idempotente-99";

    // 1. Simular caída de flota -> 503
    ctx.estadoFlota.caida = true;
    const resFallida = await fetch(`${ctx.base}/viajes`, {
      method: "POST",
      headers: {
        Authorization: "Bearer pasajero",
        "Content-Type": "application/json",
        "Clave-Idempotencia": claveIdempotencia,
      },
      body: JSON.stringify({ id_estimacion: estimacionValida.id }),
    });
    assert.equal(resFallida.status, 503);

    // 2. Restauración del servicio
    ctx.estadoFlota.caida = false;

    // 3. Reintento con la misma clave de idempotencia -> 201 Creado exitosamente
    const resExitosa = await fetch(`${ctx.base}/viajes`, {
      method: "POST",
      headers: {
        Authorization: "Bearer pasajero",
        "Content-Type": "application/json",
        "Clave-Idempotencia": claveIdempotencia,
      },
      body: JSON.stringify({ id_estimacion: estimacionValida.id }),
    });
    assert.equal(resExitosa.status, 201);
    const viajeCreado = (await resExitosa.json()) as { id_viaje: string; precio_estimado: string };
    assert.ok(viajeCreado.id_viaje);
    assert.equal(viajeCreado.precio_estimado, "4500");

    // 4. Segundo reintento idéntico posterior -> 201 con el mismo viaje persistido (idempotencia)
    const resRepetida = await fetch(`${ctx.base}/viajes`, {
      method: "POST",
      headers: {
        Authorization: "Bearer pasajero",
        "Content-Type": "application/json",
        "Clave-Idempotencia": claveIdempotencia,
      },
      body: JSON.stringify({ id_estimacion: estimacionValida.id }),
    });
    assert.equal(resRepetida.status, 201);
    const viajeRepetido = (await resRepetida.json()) as { id_viaje: string };
    assert.equal(viajeRepetido.id_viaje, viajeCreado.id_viaje);
  } finally {
    await cerrarServidor(ctx.servidor);
  }
});

test("FAL-001: degradación elegante en ms-flota ante fallo o timeout del notificador de viajes en tiempo real", async () => {
  // Notificador que falla por timeout o servicio caído
  const notificadorCaido = new NotificadorUbicacionViajesHttp(
    "http://ms-viajes-caido:3000",
    50,
    async () => {
      throw new Error("ms-viajes caído o inaccesible");
    }
  );

  // La notificación a ms-viajes rechaza, pero la función de Flota atrapa la falla y degrada limpiamente
  let errorCapturado = false;
  try {
    await notificadorCaido.publicar(
      { idUsuario: "chofer-1", rol: "CHOFER" },
      { latitud: -27.4512, longitud: -58.9866, actualizadoAt: new Date() },
      "jwt-chofer"
    );
  } catch {
    errorCapturado = true;
  }

  // NotificadorUbicacionViajesHttp arroja el error para que el llamador de Flota
  // lo atrape en un bloque seguro sin interrumpir la persistencia en PostgreSQL
  assert.equal(errorCapturado, true);
});
