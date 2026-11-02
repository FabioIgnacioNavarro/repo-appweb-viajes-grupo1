import express from "express";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  CrearEstimacion,
  ErrorTarifas,
  GeneradorIdMemoria,
  RepositorioEstimacionesMemoria,
  type ReglaTarifa,
  type ZonaTarifaria
} from "./dominio";
import { crearRouterTarifas, type DependenciasTarifas } from "./http";
import type { ActorJWT } from "../compartido/jwt";

const zona: ZonaTarifaria = {
  id: "resistencia",
  nombre: "Resistencia",
  centro: { latitud: -27.45, longitud: -58.98 },
  radioMetros: 15_000,
  zonaHoraria: "America/Argentina/Buenos_Aires"
};

const regla: ReglaTarifa = {
  version: 1,
  tarifaBasePesos: 1000n,
  precioPorKilometroPesos: 600n,
  precioPorMinutoPesos: 120n,
  multiplicadorMinimoEscalado: 7500,
  multiplicadorMaximoEscalado: 20_000,
  lluviaConPrecipitacionEscalado: 11_000,
  lluviaSinPrecipitacionEscalado: 10_000,
  disponibilidad: [{ hasta: 0, multiplicadorEscalado: 13_000 }, { hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 10_000 }],
  demandaPorMil: [{ hasta: 999, multiplicadorEscalado: 10_000 }, { hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 12_000 }],
  horario: { MADRUGADA: 10_000, MANANA: 10_000, SIESTA: 9500, TARDE: 10_500, NOCHE: 11_000 }
};

async function iniciarServidorTarifas(opciones: {
  fallarBase?: boolean;
  fallarDependencia?: boolean;
} = {}): Promise<{ base: string; servidor: Server; estimaciones: RepositorioEstimacionesMemoria }> {
  const estimaciones = new RepositorioEstimacionesMemoria();
  const ids = new GeneradorIdMemoria();
  const actores: Record<string, ActorJWT> = {
    "token-pasajero-1": { idUsuario: "pasajero-1", rol: "PASAJERO" },
    "token-pasajero-2": { idUsuario: "pasajero-2", rol: "PASAJERO" },
    "token-chofer-1": { idUsuario: "chofer-1", rol: "CHOFER" },
    "token-admin": { idUsuario: "admin-1", rol: "ADMINISTRADOR" }
  };

  const caso = new CrearEstimacion(
    {
      async calcular() {
        if (opciones.fallarDependencia) {
          throw new ErrorTarifas("DEPENDENCIA_NO_DISPONIBLE", "OSRM no respondió a tiempo.");
        }
        return { distanciaMetros: 2500, duracionSegundos: 300, proveedor: "OSRM", polilinea: "poly123" };
      }
    },
    { async consultar() { return { precipitacionMm: 0, observadaEn: new Date(Date.now() - 60_000), fuente: "OPEN_METEO" }; } },
    { async contarDisponibles() { return 5; } },
    { async contarSolicitudesActivas() { return 2; } },
    { async resolver() { return zona; } },
    { async obtenerActiva() { return regla; } },
    estimaciones,
    ids
  );

  const deps: DependenciasTarifas = {
    estimar: (pasajeroId, origen, destino) => caso.ejecutar(pasajeroId, origen, destino),
    estimaciones,
    validador: {
      async validar(token: string) {
        const actor = actores[token];
        if (!actor) throw new Error("Token inválido");
        return actor;
      }
    },
    comprobarBase: async () => {
      if (opciones.fallarBase) throw new Error("PostgreSQL caído");
    }
  };

  const app = express();
  app.use(crearRouterTarifas(deps));
  const servidor = createServer(app);
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const direccion = servidor.address();
  if (!direccion || typeof direccion === "string") throw new Error("No se pudo abrir servidor HTTP de ms-tarifas.");
  return { base: `http://127.0.0.1:${direccion.port}`, servidor, estimaciones };
}

async function cerrar(servidor: Server): Promise<void> {
  await new Promise<void>((resolver, rechazar) => servidor.close((err) => (err ? rechazar(err) : resolver())));
}

test("ms-tarifas HTTP: /health y /ready informan estado de salud y base de datos", async () => {
  const ok = await iniciarServidorTarifas();
  try {
    const health = await fetch(`${ok.base}/health`);
    assert.equal(health.status, 200);
    const ready = await fetch(`${ok.base}/ready`);
    assert.equal(ready.status, 200);
  } finally {
    await cerrar(ok.servidor);
  }

  const caido = await iniciarServidorTarifas({ fallarBase: true });
  try {
    const readyCaido = await fetch(`${caido.base}/ready`);
    assert.equal(readyCaido.status, 503);
  } finally {
    await cerrar(caido.servidor);
  }
});

test("ms-tarifas HTTP: crea estimación (201) para pasajero y permite consultarla (200) solo a su dueño o admin", async () => {
  const ctx = await iniciarServidorTarifas();
  try {
    const crearRes = await fetch(`${ctx.base}/viajes/estimacion`, {
      method: "POST",
      headers: { Authorization: "Bearer token-pasajero-1", "Content-Type": "application/json" },
      body: JSON.stringify({
        origen: { latitud: -27.45, longitud: -58.98 },
        destino: { latitud: -27.46, longitud: -58.99 }
      })
    });
    assert.equal(crearRes.status, 201);
    const cuerpo = await crearRes.json() as {
      id_estimacion: string;
      precio_estimado: string;
      moneda: string;
      factores_precio: { zona_id: string };
    };
    assert.equal(cuerpo.moneda, "ARS");
    assert.match(cuerpo.precio_estimado, /^\d+$/);
    assert.equal(cuerpo.factores_precio.zona_id, "resistencia");

    // Dueño consulta -> 200
    const propRes = await fetch(`${ctx.base}/estimaciones/${cuerpo.id_estimacion}`, {
      headers: { Authorization: "Bearer token-pasajero-1" }
    });
    assert.equal(propRes.status, 200);

    // Otro pasajero consulta -> 403 ESTIMACION_NO_AUTORIZADA
    const ajenoRes = await fetch(`${ctx.base}/estimaciones/${cuerpo.id_estimacion}`, {
      headers: { Authorization: "Bearer token-pasajero-2" }
    });
    assert.equal(ajenoRes.status, 403);
    const ajenoErr = await ajenoRes.json() as { error: { codigo: string; detalles: object } };
    assert.equal(ajenoErr.error.codigo, "ESTIMACION_NO_AUTORIZADA");
    assert.deepEqual(ajenoErr.error.detalles, {});

    // Administrador consulta -> 200
    const adminRes = await fetch(`${ctx.base}/estimaciones/${cuerpo.id_estimacion}`, {
      headers: { Authorization: "Bearer token-admin" }
    });
    assert.equal(adminRes.status, 200);
  } finally {
    await cerrar(ctx.servidor);
  }
});

test("ms-tarifas HTTP: rechaza rol CHOFER en estimación (403), entrada con precio (400), estimación vencida (409) y falla de dependencia (503)", async () => {
  const ctx = await iniciarServidorTarifas();
  try {
    // 1. Chofer intenta estimar -> 403 ROL_NO_AUTORIZADO
    const choferRes = await fetch(`${ctx.base}/viajes/estimacion`, {
      method: "POST",
      headers: { Authorization: "Bearer token-chofer-1", "Content-Type": "application/json" },
      body: JSON.stringify({
        origen: { latitud: -27.45, longitud: -58.98 },
        destino: { latitud: -27.46, longitud: -58.99 }
      })
    });
    assert.equal(choferRes.status, 403);
    const choferErr = await choferRes.json() as { error: { codigo: string; detalles: object } };
    assert.equal(choferErr.error.codigo, "ROL_NO_AUTORIZADO");
    assert.deepEqual(choferErr.error.detalles, {});

    // 2. Pasajero intenta inyectar campo precio -> 400 ENTRADA_INVALIDA con detalles: {}
    const invalidaRes = await fetch(`${ctx.base}/viajes/estimacion`, {
      method: "POST",
      headers: { Authorization: "Bearer token-pasajero-1", "Content-Type": "application/json" },
      body: JSON.stringify({
        origen: { latitud: -27.45, longitud: -58.98 },
        destino: { latitud: -27.46, longitud: -58.99 },
        precio_estimado: "100"
      })
    });
    assert.equal(invalidaRes.status, 400);
    const invalidaErr = await invalidaRes.json() as { error: { codigo: string; detalles: object } };
    assert.equal(invalidaErr.error.codigo, "ENTRADA_INVALIDA");
    assert.deepEqual(invalidaErr.error.detalles, {});

    // 3. Estimación vencida -> 409 ESTIMACION_VENCIDA
    const ahora = new Date();
    await ctx.estimaciones.guardar({
      id: "est-vencida-1",
      pasajeroId: "pasajero-1",
      origen: zona.centro,
      destino: zona.centro,
      zona,
      precioEstimado: 2000n,
      moneda: "ARS",
      distanciaMetros: 1000,
      duracionSegundos: 120,
      proveedorRuta: "OSRM",
      multiplicadorDemandaEscalado: 10_000,
      factoresPrecio: {
        choferesDisponibles: 5,
        solicitudesActivas: 1,
        precipitacionMm: 0,
        llueve: false,
        fuenteClima: "FAKE",
        climaObservadoEn: ahora,
        franjaHoraria: "MANANA",
        factorLluviaEscalado: 10_000,
        factorDisponibilidadEscalado: 10_000,
        factorDemandaEscalado: 10_000,
        factorHorarioEscalado: 10_000,
        multiplicadorAplicadoEscalado: 10_000
      },
      versionRegla: 1,
      creadaEn: new Date(ahora.getTime() - 240_000),
      vigenteHasta: new Date(ahora.getTime() - 60_000)
    });
    const vencidaRes = await fetch(`${ctx.base}/estimaciones/est-vencida-1`, {
      headers: { Authorization: "Bearer token-pasajero-1" }
    });
    assert.equal(vencidaRes.status, 409);
    const vencidaErr = await vencidaRes.json() as { error: { codigo: string } };
    assert.equal(vencidaErr.error.codigo, "ESTIMACION_VENCIDA");
  } finally {
    await cerrar(ctx.servidor);
  }

  // 4. Falla de dependencia -> 503 DEPENDENCIA_NO_DISPONIBLE
  const ctxFalla = await iniciarServidorTarifas({ fallarDependencia: true });
  try {
    const depRes = await fetch(`${ctxFalla.base}/viajes/estimacion`, {
      method: "POST",
      headers: { Authorization: "Bearer token-pasajero-1", "Content-Type": "application/json" },
      body: JSON.stringify({
        origen: { latitud: -27.45, longitud: -58.98 },
        destino: { latitud: -27.46, longitud: -58.99 }
      })
    });
    assert.equal(depRes.status, 503);
    const depErr = await depRes.json() as { error: { codigo: string } };
    assert.equal(depErr.error.codigo, "DEPENDENCIA_NO_DISPONIBLE");
  } finally {
    await cerrar(ctxFalla.servidor);
  }
});
