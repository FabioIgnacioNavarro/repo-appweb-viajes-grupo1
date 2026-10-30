import { strict as assert } from "node:assert";
import test from "node:test";
import { ErrorDependenciaHttp } from "../compartido/cliente-servicios";
import { ConfirmarViaje, CrearOfertasParaCandidatos, GeneradorIdMemoria, RepositorioIdempotenciaMemoria, RepositorioOfertasMemoria, RepositorioViajesMemoria, type ActorAutenticado, type EstimacionVigente } from "./dominio";
import { ConfirmarViajeYBuscarChoferes } from "./integracion";

const actor: ActorAutenticado = { idUsuario: "pasajero-1", rol: "PASAJERO" };
const estimacion: EstimacionVigente = { id: "estimacion-1", origen: { latitud: -27.45, longitud: -58.98 }, destino: { latitud: -27.46, longitud: -58.99 }, precioEstimado: "8086", moneda: "ARS", multiplicadorDemanda: 1.5, factoresPrecio: { zona_id: "centro" }, creadaEn: new Date(), vigenteHasta: new Date(Date.now() + 180_000) };

test("confirmación conserva exactamente precio e idempotencia, y crea ofertas solo una vez por candidato", async () => {
  const viajes = new RepositorioViajesMemoria(); const ofertas = new RepositorioOfertasMemoria(); const ids = new GeneradorIdMemoria();
  const caso = new ConfirmarViajeYBuscarChoferes(new ConfirmarViaje(viajes, new RepositorioIdempotenciaMemoria(), ids), { async buscar(_origen, jwt) { assert.equal(jwt, "jwt-pasajero"); return ["chofer-1", "chofer-1", "chofer-2"]; } }, new CrearOfertasParaCandidatos(ofertas, ids));
  const primero = await caso.ejecutar(actor, estimacion, "clave-1", "jwt-pasajero");
  const segundo = await caso.ejecutar(actor, estimacion, "clave-1", "jwt-pasajero");
  assert.equal(primero.id, segundo.id);
  assert.equal(segundo.precioEstimado, "8086");
  assert.equal(segundo.multiplicadorDemanda, 1.5);
  assert.equal((await ofertas.listarPorViaje(primero.id)).length, 2);
});

test("si flota cae, la operación falla cerrado y un reintento idempotente puede completar la búsqueda", async () => {
  const viajes = new RepositorioViajesMemoria(); const ofertas = new RepositorioOfertasMemoria(); const ids = new GeneradorIdMemoria();
  let disponible = false;
  const caso = new ConfirmarViajeYBuscarChoferes(new ConfirmarViaje(viajes, new RepositorioIdempotenciaMemoria(), ids), { async buscar() { if (!disponible) throw new ErrorDependenciaHttp("ms-flota", "buscar_candidatos"); return ["chofer-1"]; } }, new CrearOfertasParaCandidatos(ofertas, ids));
  await assert.rejects(() => caso.ejecutar(actor, estimacion, "clave-2", "jwt-pasajero"), ErrorDependenciaHttp);
  assert.equal((await viajes.listar()).length, 1);
  const viajesListados = await viajes.listar();
  assert.equal((await ofertas.listarPorViaje(viajesListados[0].id)).length, 0);
  disponible = true;
  const viajeReintentado = await caso.ejecutar(actor, estimacion, "clave-2", "jwt-pasajero");
  assert.equal((await viajes.listar()).length, 1);
  assert.equal(viajeReintentado.precioEstimado, "8086");
  assert.equal((await ofertas.listarPorViaje(viajeReintentado.id)).length, 1);
});
