import { strict as assert } from "node:assert";
import test from "node:test";
import {
  AsignarVehiculoAChofer,
  AutorizadorUbicacionBasico,
  BuscarChoferesCercanos,
  CambiarDisponibilidadChofer,
  ConsultarUbicacionChofer,
  ErrorFlota,
  HabilitarChofer,
  PurgarUbicacionesHistoricasVencidas,
  RegistrarChofer,
  RegistrarUbicacionActual,
  RegistrarVehiculo,
  RepositorioChoferesMemoria,
  RepositorioUbicacionesMemoria,
  RepositorioVehiculosMemoria,
  RepositorioViajesActivosMemoria,
  type ActorAutenticado,
  type Chofer
} from "../../src/ms-flota/dominio";

const ahora = new Date("2026-10-15T12:00:00.000Z");
const actor: ActorAutenticado = { idUsuario: "usuario-chofer-1", rol: "CHOFER" };
const chofer = (cambios: Partial<Chofer> = {}): Chofer => ({ id: "perfil-1", usuarioId: actor.idUsuario, habilitado: true, disponibilidad: false, carnetConducirValidado: true, fechaCreacion: ahora, fechaActualizacion: ahora, ...cambios });
function contexto() { const posiciones = new Map(); const choferes = new RepositorioChoferesMemoria(posiciones); const ubicaciones = new RepositorioUbicacionesMemoria(posiciones); const viajes = new RepositorioViajesActivosMemoria(); choferes.guardar(chofer()); return { choferes, ubicaciones, viajes }; }

test("cambia la disponibilidad de un chofer habilitado", async () => { const ctx = contexto(); assert.equal((await new CambiarDisponibilidadChofer(ctx.choferes).ejecutar(actor, true, ahora)).disponibilidad, true); });
test("rechaza activar un chofer no habilitado", async () => { const ctx = contexto(); await ctx.choferes.guardar(chofer({ habilitado: false })); await assert.rejects(() => new CambiarDisponibilidadChofer(ctx.choferes).ejecutar(actor, true), (error: unknown) => error instanceof ErrorFlota && error.codigo === "CHOFER_NO_HABILITADO"); });
test("descarta una ubicación antigua y conserva la nueva", async () => { const ctx = contexto(); const registrar = new RegistrarUbicacionActual(ctx.choferes, ctx.ubicaciones, () => "ubicacion"); await Promise.all([registrar.ejecutar(actor, { latitud: -27.45, longitud: -58.98 }, new Date("2026-10-15T12:00:05.000Z")), registrar.ejecutar(actor, { latitud: -27.46, longitud: -58.99 }, new Date("2026-10-15T12:00:01.000Z"))]); assert.equal((await ctx.ubicaciones.obtenerActual(actor.idUsuario))?.latitud, -27.45); });
test("encuentra choferes cercanos y excluye choferes no disponibles", async () => { const ctx = contexto(); await ctx.choferes.guardar(chofer({ id: "perfil-2", usuarioId: "chofer-cercano", disponibilidad: true })); const registrar = new RegistrarUbicacionActual(ctx.choferes, ctx.ubicaciones, () => "ubicacion"); await registrar.ejecutar({ idUsuario: "chofer-cercano", rol: "CHOFER" }, { latitud: -27.4501, longitud: -58.9801 }, ahora); const resultados = await new BuscarChoferesCercanos(ctx.choferes, ctx.viajes).ejecutar({ idUsuario: "pasajero", rol: "PASAJERO" }, { latitud: -27.45, longitud: -58.98 }, 1000, ahora); assert.deepEqual(resultados.map((resultado) => resultado.usuarioId), ["chofer-cercano"]); });
test("un chofer con viaje activo no es candidato", async () => { const ctx = contexto(); const registrar = new RegistrarUbicacionActual(ctx.choferes, ctx.ubicaciones, () => "ubicacion"); await registrar.ejecutar(actor, { latitud: -27.45, longitud: -58.98 }, ahora); await new CambiarDisponibilidadChofer(ctx.choferes).ejecutar(actor, true, ahora); ctx.viajes.marcarActivo(actor.idUsuario); assert.equal((await new BuscarChoferesCercanos(ctx.choferes, ctx.viajes).ejecutar({ idUsuario: "pasajero", rol: "PASAJERO" }, { latitud: -27.45, longitud: -58.98 }, 1000, ahora)).length, 0); });
test("no permite consultar la ubicación privada de otro usuario", async () => { const ctx = contexto(); const registrar = new RegistrarUbicacionActual(ctx.choferes, ctx.ubicaciones, () => "ubicacion"); await registrar.ejecutar(actor, { latitud: -27.45, longitud: -58.98 }, ahora); await assert.rejects(() => new ConsultarUbicacionChofer(ctx.choferes, ctx.ubicaciones, new AutorizadorUbicacionBasico()).ejecutar({ idUsuario: "otro", rol: "PASAJERO" }, actor.idUsuario), (error: unknown) => error instanceof ErrorFlota && error.codigo === "UBICACION_NO_AUTORIZADA"); });

test("alta de chofer, registro/asignación de vehículo, habilitación administrativa y validación previa a disponibilidad", async () => {
  const choferes = new RepositorioChoferesMemoria();
  const vehiculos = new RepositorioVehiculosMemoria();
  const admin: ActorAutenticado = { idUsuario: "admin-1", rol: "ADMINISTRADOR" };
  const choferNuevo: ActorAutenticado = { idUsuario: "chofer-nuevo", rol: "CHOFER" };
  let sec = 0;
  const genId = () => `id-${++sec}`;

  const perfil = await new RegistrarChofer(choferes, genId).ejecutar(choferNuevo, {}, ahora);
  assert.equal(perfil.habilitado, false);
  assert.equal(perfil.disponibilidad, false);

  await assert.rejects(
    () => new HabilitarChofer(choferes).ejecutar(choferNuevo, choferNuevo.idUsuario, { habilitado: true }, ahora),
    (e: unknown) => e instanceof ErrorFlota && e.codigo === "ROL_NO_AUTORIZADO"
  );

  const habilitado = await new HabilitarChofer(choferes).ejecutar(admin, choferNuevo.idUsuario, { habilitado: true, carnetConducirValidado: true }, ahora);
  assert.equal(habilitado.habilitado, true);

  await assert.rejects(
    () => new CambiarDisponibilidadChofer(choferes, vehiculos).ejecutar(choferNuevo, true, ahora),
    (e: unknown) => e instanceof ErrorFlota && e.codigo === "CHOFER_SIN_VEHICULO_ACTIVO"
  );

  const auto = await new RegistrarVehiculo(vehiculos, genId).ejecutar(admin, {
    patente: "AC999ZZ", tipoVehiculo: "AUTOMOVIL", marca: "Renault", modelo: "Logan",
    anioFabricacion: 2024, color: "Gris", capacidadPasajeros: 4
  }, ahora);
  await new AsignarVehiculoAChofer(choferes, vehiculos, genId).ejecutar(admin, choferNuevo.idUsuario, auto.id, ahora);

  const disponible = await new CambiarDisponibilidadChofer(choferes, vehiculos).ejecutar(choferNuevo, true, ahora);
  assert.equal(disponible.disponibilidad, true);

  const deshabilitado = await new HabilitarChofer(choferes).ejecutar(admin, choferNuevo.idUsuario, { habilitado: false }, ahora);
  assert.equal(deshabilitado.habilitado, false);
  assert.equal(deshabilitado.disponibilidad, false);
});

test("ADR 0010: persiste historial cada 15s, purga ubicaciones > 60 días y conserva recientes y ubicacion_actual", async () => {
  const ctx = contexto();
  const registrar = new RegistrarUbicacionActual(ctx.choferes, ctx.ubicaciones, () => "u-hist");
  const t0 = new Date("2026-08-01T12:00:00.000Z");
  await registrar.ejecutar(actor, { latitud: -27.45, longitud: -58.98 }, t0);
  // A los 5s no debería generar nueva entrada histórica
  await registrar.ejecutar(actor, { latitud: -27.451, longitud: -58.981 }, new Date(t0.getTime() + 5_000));
  // A los 16s sí genera segunda entrada histórica
  await registrar.ejecutar(actor, { latitud: -27.452, longitud: -58.982 }, new Date(t0.getTime() + 16_000));
  assert.equal(ctx.ubicaciones.listarHistoricas(actor.idUsuario).length, 2);

  // Registro reciente (59 días atrás respecto a tRef) y registro vencido (> 60 días atrás)
  const tRef = new Date("2026-10-15T12:00:00.000Z");
  await registrar.ejecutar(actor, { latitud: -27.453, longitud: -58.983 }, new Date(tRef.getTime() - 59 * 86_400_000));
  assert.equal(ctx.ubicaciones.listarHistoricas(actor.idUsuario).length, 3);

  const resultado = await new PurgarUbicacionesHistoricasVencidas(ctx.ubicaciones, 60).ejecutar(tRef);
  assert.equal(resultado.eliminados, 2);
  assert.equal(ctx.ubicaciones.listarHistoricas(actor.idUsuario).length, 1);
  // ubicacion_actual nunca se borra por la política de retención
  assert.ok(await ctx.ubicaciones.obtenerActual(actor.idUsuario));
});
