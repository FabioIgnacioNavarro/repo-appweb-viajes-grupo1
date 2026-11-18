import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { ClienteServiciosHttp } from "../../src/compartido/cliente-servicios";
import {
  AceptarOferta, AsignadorAtomicoMemoria, AvanzarViaje, CancelarViaje, ConsultarOfertasChofer,
  ConfirmarViaje, ConsultarViaje, FinalizarViaje, GeneradorIdMemoria, RechazarOferta,
  RepositorioCobrosMemoria, RepositorioIdempotenciaMemoria, RepositorioOfertasMemoria,
  RepositorioViajesMemoria, type ActorAutenticado
} from "../../src/ms-viajes/dominio";
import { ClienteTarifasHttp } from "../../src/ms-viajes/clientes-http";
import { crearRouterViajes } from "../../src/ms-viajes/http";
import { crearRouterTarifas } from "../../src/ms-tarifas/http";
import {
  CrearEstimacion, GeneradorIdMemoria as GeneradorIdTarifasMemoria,
  RepositorioEstimacionesMemoria, type ReglaTarifa, type ZonaTarifaria
} from "../../src/ms-tarifas/dominio";

const token = "jwt-pasajero-dom-005";
const actor: ActorAutenticado = { idUsuario: "pasajero-dom-005", rol: "PASAJERO" };
const zona: ZonaTarifaria = {
  id: "resistencia", nombre: "Resistencia", centro: { latitud: -27.45, longitud: -58.98 },
  radioMetros: 15_000, zonaHoraria: "America/Argentina/Buenos_Aires"
};
const regla: ReglaTarifa = {
  version: 1, tarifaBasePesos: 1000n, precioPorKilometroPesos: 600n, precioPorMinutoPesos: 120n,
  multiplicadorMinimoEscalado: 7500, multiplicadorMaximoEscalado: 20_000,
  lluviaConPrecipitacionEscalado: 11_000, lluviaSinPrecipitacionEscalado: 10_000,
  disponibilidad: [
    { hasta: 0, multiplicadorEscalado: 13_000 },
    { hasta: 2, multiplicadorEscalado: 12_000 },
    { hasta: 5, multiplicadorEscalado: 11_000 },
    { hasta: 11, multiplicadorEscalado: 10_000 },
    { hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 9000 }
  ],
  demandaPorMil: [
    { hasta: 999, multiplicadorEscalado: 10_000 },
    { hasta: 1999, multiplicadorEscalado: 11_000 },
    { hasta: 2999, multiplicadorEscalado: 12_000 },
    { hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 13_000 }
  ],
  horario: { MADRUGADA: 10_000, MANANA: 10_000, SIESTA: 9500, TARDE: 10_500, NOCHE: 11_000 }
};

async function iniciar(app: express.Express): Promise<{ base: string; servidor: Server }> {
  const servidor = createServer(app);
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const direccion = servidor.address();
  if (!direccion || typeof direccion === "string") throw new Error("No se pudo iniciar el servidor de prueba.");
  return { base: `http://127.0.0.1:${direccion.port}`, servidor };
}

async function cerrar(servidor: Server): Promise<void> {
  await new Promise<void>((resolver, rechazar) => servidor.close((error) => error ? rechazar(error) : resolver()));
}

test("DOM-005: confirma el snapshot aceptado aunque recalcular cambie clima y demanda durante la confirmación", async () => {
  let precipitacionMm = 0;
  let choferesDisponibles = 20;
  let solicitudesActivas = 1;
  const estimaciones = new RepositorioEstimacionesMemoria();
  const crearEstimacion = new CrearEstimacion(
    { async calcular() { return { distanciaMetros: 1000, duracionSegundos: 180, proveedor: "HAVERSINE" as const }; } },
    { async consultar() { return { precipitacionMm, observadaEn: new Date(), fuente: "CLIMA_PRUEBA" }; } },
    { async contarDisponibles() { return choferesDisponibles; } },
    { async contarSolicitudesActivas() { return solicitudesActivas; } },
    { async resolver() { return zona; } },
    { async obtenerActiva() { return regla; } },
    estimaciones,
    new GeneradorIdTarifasMemoria()
  );
  const appTarifas = express();
  appTarifas.use(crearRouterTarifas({
    estimar: (pasajeroId, origen, destino) => crearEstimacion.ejecutar(pasajeroId, origen, destino),
    estimaciones,
    validador: { async validar(jwt) { if (jwt !== token) throw new Error("JWT de prueba inválido."); return actor; } },
    comprobarBase: async () => undefined
  }));
  const tarifas = await iniciar(appTarifas);

  const viajes = new RepositorioViajesMemoria();
  const ofertas = new RepositorioOfertasMemoria();
  const cobros = new RepositorioCobrosMemoria();
  const idempotencia = new RepositorioIdempotenciaMemoria();
  const ids = new GeneradorIdMemoria();
  const asignador = new AsignadorAtomicoMemoria();
  const confirmar = new ConfirmarViaje(viajes, idempotencia, ids);
  let senalLectura: () => void = () => undefined;
  const estimacionLeida = new Promise<void>((resolver) => { senalLectura = resolver; });
  let liberarConfirmacion: () => void = () => undefined;
  const barreraConfirmacion = new Promise<void>((resolver) => { liberarConfirmacion = resolver; });
  const clienteTarifas = new ClienteTarifasHttp(tarifas.base, new ClienteServiciosHttp({ reintentos: 0 }));
  const appViajes = express();
  appViajes.use(crearRouterViajes({
    viajes,
    ofertas,
    confirmar,
    aceptar: new AceptarOferta(ofertas, viajes, asignador),
    rechazar: new RechazarOferta(ofertas),
    cancelar: new CancelarViaje(viajes, asignador),
    avanzar: new AvanzarViaje(viajes),
    finalizar: new FinalizarViaje(viajes, cobros, asignador, ids),
    consultar: new ConsultarViaje(viajes),
    consultarOfertas: new ConsultarOfertasChofer(ofertas),
    validadorToken: { async validar(jwt) { if (jwt !== token) throw new Error("JWT de prueba inválido."); return actor; } },
    obtenerEstimacion: (_actor, id, jwt) => clienteTarifas.obtenerEstimacion(id, jwt),
    confirmarConOfertas: async (actorConfirmacion, estimacion, clave) => {
      senalLectura();
      await barreraConfirmacion;
      return confirmar.ejecutar(actorConfirmacion, estimacion, clave);
    }
  }));
  const servicioViajes = await iniciar(appViajes);

  const encabezados = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const ubicaciones = JSON.stringify({ origen: zona.centro, destino: { latitud: -27.46, longitud: -58.99 } });
  try {
    const respuestaPrimera = await fetch(`${tarifas.base}/viajes/estimacion`, { method: "POST", headers: encabezados, body: ubicaciones });
    assert.equal(respuestaPrimera.status, 201);
    const primera = await respuestaPrimera.json() as {
      id_estimacion: string; precio_estimado: string; multiplicador_demanda: number;
      factores_precio: Record<string, unknown>;
    };

    const confirmarPendiente = fetch(`${servicioViajes.base}/viajes`, {
      method: "POST", headers: { ...encabezados, "Clave-Idempotencia": "dom-005-confirmacion" },
      body: JSON.stringify({ id_estimacion: primera.id_estimacion })
    });
    await estimacionLeida;

    // La estimación aceptada ya salió de ms-tarifas. En paralelo cambian sus insumos
    // y se calcula una cotización nueva para ese mismo trayecto.
    precipitacionMm = 3.2;
    choferesDisponibles = 0;
    solicitudesActivas = 30;
    const respuestaNueva = await fetch(`${tarifas.base}/viajes/estimacion`, { method: "POST", headers: encabezados, body: ubicaciones });
    assert.equal(respuestaNueva.status, 201);
    const nueva = await respuestaNueva.json() as {
      precio_estimado: string; multiplicador_demanda: number; factores_precio: Record<string, unknown>;
    };
    assert.notEqual(nueva.precio_estimado, primera.precio_estimado);
    assert.notEqual(nueva.multiplicador_demanda, primera.multiplicador_demanda);

    liberarConfirmacion();
    const respuestaViaje = await confirmarPendiente;
    assert.equal(respuestaViaje.status, 201);
    const viaje = await respuestaViaje.json() as {
      id_estimacion: string; precio_estimado: string; multiplicador_demanda: number;
      factores_precio: Record<string, unknown>;
    };
    assert.equal(viaje.id_estimacion, primera.id_estimacion);
    assert.equal(viaje.precio_estimado, primera.precio_estimado);
    assert.equal(viaje.multiplicador_demanda, primera.multiplicador_demanda);
    assert.deepEqual(viaje.factores_precio, { ...primera.factores_precio, version_regla: 1 });
  } finally {
    liberarConfirmacion();
    await cerrar(servicioViajes.servidor);
    await cerrar(tarifas.servidor);
  }
});
