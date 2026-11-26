import express from "express";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  CrearEstimacion,
  ErrorTarifas,
  GeneradorIdMemoria,
  GestionarReglaDemanda,
  RepositorioEstimacionesMemoria,
  RepositorioReglasMemoria,
  type ReglaTarifa,
  type ZonaTarifaria
} from "../../src/ms-tarifas/dominio";
import { crearRouterTarifas, type DependenciasTarifas } from "../../src/ms-tarifas/http";
import type { ActorJWT } from "../../src/compartido/jwt";

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
  modoDesarrollador?: boolean;
} = {}): Promise<{ base: string; servidor: Server; estimaciones: RepositorioEstimacionesMemoria }> {
  const estimaciones = new RepositorioEstimacionesMemoria();
  const repoReglas = new RepositorioReglasMemoria(regla);
  const gestionarRegla = new GestionarReglaDemanda(repoReglas);
  const ids = new GeneradorIdMemoria();
  const actores: Record<string, ActorJWT> = {
    "token-pasajero-1": { idUsuario: "pasajero-1", rol: "PASAJERO" },
    "token-pasajero-2": { idUsuario: "pasajero-2", rol: "PASAJERO" },
    "token-chofer-1": { idUsuario: "chofer-1", rol: "CHOFER" },
    "token-soporte-1": { idUsuario: "soporte-1", rol: "SOPORTE" },
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
    repoReglas,
    estimaciones,
    ids
  );

  const deps: DependenciasTarifas = {
    estimar: (pasajeroId, origen, destino, _token, simulacion) =>
      caso.ejecutar(pasajeroId, origen, destino, new Date(), simulacion),
    estimaciones,
    reglas: gestionarRegla,
    modoDesarrollador: opciones.modoDesarrollador ?? false,
    geocodificarInversa: async (c) => `Juan B. Justo 4, Resistencia (${c.latitud.toFixed(3)})`,
    autocompletar: async (consulta) =>
      consulta.toLowerCase().includes("alberdi")
        ? [{ etiqueta: "Av. Alberdi 250, Resistencia", latitud: -27.4538, longitud: -58.9845 }]
        : [],
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

test("ms-tarifas HTTP: GET/PUT /reglas/demanda aplica RBAC, valida curva y registra autor del JWT y versión", async () => {
  const ctx = await iniciarServidorTarifas();
  try {
    // 1. SOPORTE y PASAJERO reciben 403 en GET y PUT
    for (const token of ["token-soporte-1", "token-pasajero-1", "token-chofer-1"]) {
      const getForbidden = await fetch(`${ctx.base}/reglas/demanda`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(getForbidden.status, 403);
      const getErr = await getForbidden.json() as { error: { codigo: string } };
      assert.equal(getErr.error.codigo, "ROL_NO_AUTORIZADO");

      const putForbidden = await fetch(`${ctx.base}/reglas/demanda`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          multiplicador_minimo: 0.8,
          multiplicador_maximo: 2.2,
          demanda_por_mil: [{ hasta: null, multiplicador: 1.1 }]
        })
      });
      assert.equal(putForbidden.status, 403);
    }

    // 2. ADMINISTRADOR consulta v1 activa e historial
    const getOk = await fetch(`${ctx.base}/reglas/demanda`, {
      headers: { Authorization: "Bearer token-admin" }
    });
    assert.equal(getOk.status, 200);
    const inicial = await getOk.json() as {
      activa: { version: number; autor: string; demanda_por_mil: Array<{ hasta: number | null; multiplicador: number }> };
      historial: Array<{ version: number; autor: string; activa: boolean }>;
    };
    assert.equal(inicial.activa.version, 1);
    assert.equal(inicial.activa.autor, "sistema");
    assert.equal(inicial.activa.demanda_por_mil.at(-1)?.hasta, null);
    assert.equal(inicial.historial.length, 1);

    // 3. ADMINISTRADOR no puede enviar autor, version, fecha o precio (400 ENTRADA_INVALIDA)
    const spoofRes = await fetch(`${ctx.base}/reglas/demanda`, {
      method: "PUT",
      headers: { Authorization: "Bearer token-admin", "Content-Type": "application/json" },
      body: JSON.stringify({
        autor: "otro-admin",
        version: 99,
        multiplicador_minimo: 0.75,
        multiplicador_maximo: 2.0,
        demanda_por_mil: [{ hasta: null, multiplicador: 1.0 }]
      })
    });
    assert.equal(spoofRes.status, 400);
    const spoofErr = await spoofRes.json() as { error: { codigo: string } };
    assert.equal(spoofErr.error.codigo, "ENTRADA_INVALIDA");

    // 4. ADMINISTRADOR publica curva inválida -> 422 REGLA_INVALIDA
    const invalidaRes = await fetch(`${ctx.base}/reglas/demanda`, {
      method: "PUT",
      headers: { Authorization: "Bearer token-admin", "Content-Type": "application/json" },
      body: JSON.stringify({
        multiplicador_minimo: 0.75,
        multiplicador_maximo: 2.0,
        demanda_por_mil: [
          { hasta: 999, multiplicador: 1.5 },
          { hasta: null, multiplicador: 1.0 }
        ]
      })
    });
    assert.equal(invalidaRes.status, 422);
    const invalidaErr = await invalidaRes.json() as { error: { codigo: string } };
    assert.equal(invalidaErr.error.codigo, "REGLA_INVALIDA");

    // 5. ADMINISTRADOR publica nueva versión válida -> version 2 con autor del JWT
    const putOk = await fetch(`${ctx.base}/reglas/demanda`, {
      method: "PUT",
      headers: { Authorization: "Bearer token-admin", "Content-Type": "application/json" },
      body: JSON.stringify({
        multiplicador_minimo: 0.8,
        multiplicador_maximo: 2.5,
        lluvia_con_precipitacion: 1.15,
        lluvia_sin_precipitacion: 1.0,
        demanda_por_mil: [
          { hasta: 999, multiplicador: 1.0 },
          { hasta: 1999, multiplicador: 1.2 },
          { hasta: null, multiplicador: 1.45 }
        ]
      })
    });
    assert.equal(putOk.status, 200);
    const actualizada = await putOk.json() as {
      activa: { version: number; autor: string; multiplicador_maximo: number };
      historial: Array<{ version: number; autor: string; activa: boolean }>;
    };
    assert.equal(actualizada.activa.version, 2);
    assert.equal(actualizada.activa.autor, "admin-1");
    assert.equal(actualizada.activa.multiplicador_maximo, 2.5);
    assert.equal(actualizada.historial.length, 2);
    assert.equal(actualizada.historial[0]?.activa, true);
    assert.equal(actualizada.historial[1]?.activa, false);
  } finally {
    await cerrar(ctx.servidor);
  }
});

test("ms-tarifas HTTP: POST /tarifas/geocodificacion-inversa devuelve dirección legible y aplica RBAC", async () => {
  const ctx = await iniciarServidorTarifas();
  try {
    const okRes = await fetch(`${ctx.base}/tarifas/geocodificacion-inversa`, {
      method: "POST",
      headers: { Authorization: "Bearer token-pasajero-1", "Content-Type": "application/json" },
      body: JSON.stringify({ latitud: -27.45213, longitud: -58.98738 })
    });
    assert.equal(okRes.status, 200);
    const okBody = await okRes.json() as { direccion: string; coordenada: { latitud: number; longitud: number } };
    assert.match(okBody.direccion, /Juan B\. Justo 4, Resistencia/);
    assert.equal(okBody.coordenada.latitud, -27.45213);

    const forbiddenRes = await fetch(`${ctx.base}/tarifas/geocodificacion-inversa`, {
      method: "POST",
      headers: { Authorization: "Bearer token-chofer-1", "Content-Type": "application/json" },
      body: JSON.stringify({ latitud: -27.45213, longitud: -58.98738 })
    });
    assert.equal(forbiddenRes.status, 403);

    const badRes = await fetch(`${ctx.base}/tarifas/geocodificacion-inversa`, {
      method: "POST",
      headers: { Authorization: "Bearer token-pasajero-1", "Content-Type": "application/json" },
      body: JSON.stringify({ latitud: 999, longitud: -58.98738 })
    });
    assert.equal(badRes.status, 400);
  } finally {
    await cerrar(ctx.servidor);
  }
});

test("DEV-001: POST /viajes/estimacion bloquea simulación fuera de modo desarrollador y la habilita cuando está activo", async () => {
  const ctxBloqueado = await iniciarServidorTarifas({ modoDesarrollador: false });
  try {
    const res403 = await fetch(`${ctxBloqueado.base}/viajes/estimacion`, {
      method: "POST",
      headers: { Authorization: "Bearer token-pasajero-1", "Content-Type": "application/json" },
      body: JSON.stringify({
        origen: zona.centro,
        destino: zona.centro,
        simulacion: { hora: 22, llueve: true }
      })
    });
    assert.equal(res403.status, 403);
    const body403 = await res403.json() as { error: { codigo: string } };
    assert.equal(body403.error.codigo, "MODO_DESARROLLADOR_DESHABILITADO");
  } finally {
    await cerrar(ctxBloqueado.servidor);
  }

  const ctxActivo = await iniciarServidorTarifas({ modoDesarrollador: true });
  try {
    const res201 = await fetch(`${ctxActivo.base}/viajes/estimacion`, {
      method: "POST",
      headers: { Authorization: "Bearer token-pasajero-1", "Content-Type": "application/json" },
      body: JSON.stringify({
        origen: zona.centro,
        destino: zona.centro,
        simulacion: { hora: 22, llueve: true, choferes_disponibles: 0, solicitudes_activas: 5 }
      })
    });
    assert.equal(res201.status, 201);
    const body201 = await res201.json() as {
      factores_precio: { franja_horaria: string; llueve: boolean; choferes_disponibles: number; solicitudes_activas: number };
      recomendaciones: string[];
    };
    assert.equal(body201.factores_precio.franja_horaria, "noche");
    assert.equal(body201.factores_precio.llueve, true);
    assert.equal(body201.factores_precio.choferes_disponibles, 0);
    assert.equal(body201.factores_precio.solicitudes_activas, 5);
    assert.ok(Array.isArray(body201.recomendaciones) && body201.recomendaciones.length > 0);
  } finally {
    await cerrar(ctxActivo.servidor);
  }
});

test("ms-tarifas HTTP: POST /tarifas/autocompletar devuelve sugerencias para pasajero y aplica RBAC", async () => {
  const ctx = await iniciarServidorTarifas();
  try {
    const okRes = await fetch(`${ctx.base}/tarifas/autocompletar`, {
      method: "POST",
      headers: { Authorization: "Bearer token-pasajero-1", "Content-Type": "application/json" },
      body: JSON.stringify({ consulta: "avenida alberdi", centro: { latitud: -27.45, longitud: -58.98 } })
    });
    assert.equal(okRes.status, 200);
    const okBody = await okRes.json() as { sugerencias: Array<{ etiqueta: string; latitud: number; longitud: number }> };
    assert.equal(okBody.sugerencias.length, 1);
    assert.equal(okBody.sugerencias[0]?.etiqueta, "Av. Alberdi 250, Resistencia");

    const forbiddenRes = await fetch(`${ctx.base}/tarifas/autocompletar`, {
      method: "POST",
      headers: { Authorization: "Bearer token-chofer-1", "Content-Type": "application/json" },
      body: JSON.stringify({ consulta: "avenida alberdi" })
    });
    assert.equal(forbiddenRes.status, 403);

    const badRes = await fetch(`${ctx.base}/tarifas/autocompletar`, {
      method: "POST",
      headers: { Authorization: "Bearer token-pasajero-1", "Content-Type": "application/json" },
      body: JSON.stringify({ consulta: "avenida alberdi", centro: { latitud: 999, longitud: -58.98 } })
    });
    assert.equal(badRes.status, 400);
  } finally {
    await cerrar(ctx.servidor);
  }
});
