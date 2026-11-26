import { test, expect } from "@playwright/test";
import { iniciarConPerfilDemo } from "./ayudantes-login";
import express from "express";
import { createServer, type Server } from "node:http";
import {
  CrearEstimacion,
  GeneradorIdMemoria,
  GestionarReglaDemanda,
  RepositorioEstimacionesMemoria,
  RepositorioReglasMemoria,
  type ReglaTarifa,
  type ZonaTarifaria,
} from "../../src/ms-tarifas/dominio";
import { crearRouterTarifas } from "../../src/ms-tarifas/http";
import type { ActorJWT } from "../../src/compartido/jwt";

const ZONA_DEMO: ZonaTarifaria = {
  id: "resistencia",
  nombre: "Resistencia",
  centro: { latitud: -27.45, longitud: -58.98 },
  radioMetros: 15_000,
  zonaHoraria: "America/Argentina/Buenos_Aires",
};

const REGLA_INICIAL: ReglaTarifa = {
  version: 1,
  tarifaBasePesos: 1000n,
  precioPorKilometroPesos: 600n,
  precioPorMinutoPesos: 120n,
  multiplicadorMinimoEscalado: 7500,
  multiplicadorMaximoEscalado: 20_000,
  lluviaConPrecipitacionEscalado: 11_000,
  lluviaSinPrecipitacionEscalado: 10_000,
  disponibilidad: [
    { hasta: 0, multiplicadorEscalado: 13_000 },
    { hasta: 2, multiplicadorEscalado: 12_000 },
    { hasta: 5, multiplicadorEscalado: 11_000 },
    { hasta: 11, multiplicadorEscalado: 10_000 },
    { hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 9000 },
  ],
  demandaPorMil: [
    { hasta: 999, multiplicadorEscalado: 10_000 },
    { hasta: 1999, multiplicadorEscalado: 11_000 },
    { hasta: 2999, multiplicadorEscalado: 12_000 },
    { hasta: Number.MAX_SAFE_INTEGER, multiplicadorEscalado: 13_000 },
  ],
  horario: {
    MADRUGADA: 10_000,
    MANANA: 10_000,
    SIESTA: 9500,
    TARDE: 10_500,
    NOCHE: 11_000,
  },
};

function emitirJwtFalso(id: string, rol: string, nombre: string): string {
  const payload = {
    sub: id,
    idUsuario: id,
    rol: rol.toUpperCase(),
    name: nombre,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  return `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firma-demo`;
}

function decodificarJwtFalso(token: string): ActorJWT {
  const partes = token.split(".");
  if (partes.length !== 3) throw new Error("JWT inválido");
  const datos = JSON.parse(Buffer.from(partes[1]!, "base64url").toString("utf8")) as {
    sub?: string;
    idUsuario?: string;
    rol?: ActorJWT["rol"];
  };
  if (!datos.rol || (!datos.idUsuario && !datos.sub)) throw new Error("Claims incompletos");
  return { idUsuario: datos.idUsuario ?? datos.sub!, rol: datos.rol };
}

test.describe("WEB-008 - Panel de Operador (auditoría API-002) y Administrador (reglas versionadas)", () => {
  let servidorTarifas: Server;
  let baseTarifas: string;

  test.beforeEach(async () => {
    const repoReglas = new RepositorioReglasMemoria(REGLA_INICIAL);
    const estimaciones = new RepositorioEstimacionesMemoria();
    const casoEstimar = new CrearEstimacion(
      { async calcular() { return { distanciaMetros: 2500, duracionSegundos: 300, proveedor: "OSRM" }; } },
      { async consultar() { return { precipitacionMm: 0, observadaEn: new Date(Date.now() - 60_000), fuente: "OPEN_METEO" }; } },
      { async contarDisponibles() { return 5; } },
      { async contarSolicitudesActivas() { return 2; } },
      { async resolver() { return ZONA_DEMO; } },
      repoReglas,
      estimaciones,
      new GeneradorIdMemoria()
    );
    const app = express();
    app.use(
      crearRouterTarifas({
        estimar: (pasajeroId, origen, destino) => casoEstimar.ejecutar(pasajeroId, origen, destino),
        estimaciones,
        reglas: new GestionarReglaDemanda(repoReglas),
        validador: { async validar(token) { return decodificarJwtFalso(token); } },
        comprobarBase: async () => undefined,
      })
    );
    servidorTarifas = createServer(app);
    await new Promise<void>((res) => servidorTarifas.listen(0, "127.0.0.1", res));
    const dir = servidorTarifas.address();
    if (!dir || typeof dir === "string") throw new Error("No se pudo iniciar ms-tarifas embebido");
    baseTarifas = `http://127.0.0.1:${dir.port}`;
  });

  test.afterEach(async () => {
    await new Promise<void>((res, rej) => servidorTarifas.close((err) => (err ? rej(err) : res())));
  });

  test("operador (SOPORTE) lista viajes, filtra, inspecciona auditoría y tiene denegada administración", async ({ page }) => {
    const consultasViajes: string[] = [];

    await page.route("**/auth/token", async (route) => {
      const body = route.request().postDataJSON() as { id_usuario?: string; rol?: string; nombre?: string };
      const id = body.id_usuario ?? "44444444-4444-4444-8444-444444444444";
      const rol = body.rol ?? "soporte";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: emitirJwtFalso(id, rol, body.nombre ?? "Lucía Operaciones"),
          id_usuario: id,
          rol: rol.toLowerCase(),
        }),
      });
    });

    await page.route("**/reglas/demanda", async (route) => {
      const headers = await route.request().allHeaders();
      const resp = await fetch(`${baseTarifas}/reglas/demanda`, {
        method: route.request().method(),
        headers: {
          authorization: headers.authorization ?? "",
          "content-type": "application/json",
        },
        body: route.request().postData() ?? undefined,
      });
      await route.fulfill({
        status: resp.status,
        contentType: "application/json",
        body: await resp.text(),
      });
    });

    const viajesMock = [
      {
        id_viaje: "viaje-op-1",
        pasajero_id: "pasajero-1",
        chofer_id: "chofer-1",
        id_estimacion: "est-1",
        precio_estimado: "3850",
        precio_final: "3850",
        moneda: "ARS",
        multiplicador_demanda: 1.25,
        estado: "finalizado",
        creado_en: "2026-11-18T14:00:00.000Z",
      },
      {
        id_viaje: "viaje-op-2",
        pasajero_id: "pasajero-2",
        chofer_id: null,
        id_estimacion: "est-2",
        precio_estimado: "2900",
        precio_final: null,
        moneda: "ARS",
        multiplicador_demanda: 1.0,
        estado: "solicitado",
        creado_en: "2026-11-18T15:00:00.000Z",
      },
    ];

    await page.route("**/viajes/*/auditoria-tarifa", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id_viaje: "viaje-op-1",
          id_estimacion: "est-1",
          precio_confirmado: "3850",
          moneda: "ARS",
          multiplicador_demanda: 1.25,
          factores_precio: {
            zona_id: "resistencia",
            choferes_disponibles: 4,
            solicitudes_activas: 5,
            precipitacion_mm: 0.8,
            llueve: true,
            fuente_clima: "OPEN_METEO",
            franja_horaria: "tarde",
            factor_lluvia: 1.1,
            factor_disponibilidad: 1.1,
            factor_demanda: 1.1,
            factor_horario: 1.05,
          },
          version_regla: 1,
          congelada_en: "2026-11-18T14:00:00.000Z",
        }),
      });
    });

    await page.route("**/viajes?*", async (route) => {
      const url = new URL(route.request().url());
      consultasViajes.push(url.search);
      const estado = url.searchParams.get("estado");
      const filtrados = estado ? viajesMock.filter((v) => v.estado === estado) : viajesMock;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          viajes: filtrados,
          pagina: Number(url.searchParams.get("pagina") ?? "1"),
          limite: Number(url.searchParams.get("limite") ?? "20"),
          total: filtrados.length,
        }),
      });
    });

    await page.goto("/#/login");
    await iniciarConPerfilDemo(page, /Lucía Operaciones/i);
    await expect(page).toHaveURL(/#\/operador/);

    // Verifica listado inicial
    await expect(page.getByTestId("operador-kpi-total")).toHaveText("2");
    await expect(page.locator("table").getByText("viaje-op-1")).toBeVisible();
    await expect(page.locator("table").getByText("viaje-op-2")).toBeVisible();

    // Filtra por estado finalizado
    await page.getByLabel("Estado del viaje").selectOption("finalizado");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page.getByTestId("operador-kpi-total")).toHaveText("1");
    await expect(page.locator("table").getByText("viaje-op-1")).toBeVisible();
    expect(consultasViajes.some((q) => q.includes("estado=finalizado"))).toBe(true);

    // Abre modal de auditoría inmutable
    await page.getByRole("button", { name: "Auditar tarifa" }).first().click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("$ 3.850 ARS");
    await expect(modal).toContainText("1.2500x");
    await expect(modal).toContainText("Regla v1");
    await expect(modal).toContainText("OPEN_METEO");
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();

    // SOPORTE no puede editar reglas en backend (403) ni acceder a #/admin
    const respuestaBackendSoporte = await page.evaluate(async () => {
      const sesion = JSON.parse(sessionStorage.getItem("viajes_grupo1_sesion") || "{}");
      const token = sesion.token || "";
      const res = await fetch("/reglas/demanda", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          multiplicador_minimo: 0.75,
          multiplicador_maximo: 2.0,
          demanda_por_mil: [{ hasta: null, multiplicador: 1.0 }],
        }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(respuestaBackendSoporte.status).toBe(403);
    expect(respuestaBackendSoporte.body.error.codigo).toBe("ROL_NO_AUTORIZADO");

    await page.goto("/#/admin");
    await expect(page).toHaveURL(/#\/no_autorizado/);
  });

  test("administrador edita la regla de demanda, crea nueva versión con autor JWT y conserva historial", async ({ page }) => {
    const payloadsEnviados: Array<Record<string, unknown>> = [];

    await page.route("**/auth/token", async (route) => {
      const body = route.request().postDataJSON() as { id_usuario?: string; rol?: string; nombre?: string };
      const id = body.id_usuario ?? "99999999-9999-4999-8999-999999999999";
      const rol = body.rol ?? "administrador";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: emitirJwtFalso(id, rol, body.nombre ?? "Martín Administrador"),
          id_usuario: id,
          rol: rol.toLowerCase(),
        }),
      });
    });

    await page.route("**/ready/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ estado: "listo" }) })
    );

    await page.route("**/reglas/demanda", async (route) => {
      if (route.request().method() === "PUT") {
        payloadsEnviados.push(route.request().postDataJSON() as Record<string, unknown>);
      }
      const headers = await route.request().allHeaders();
      const resp = await fetch(`${baseTarifas}/reglas/demanda`, {
        method: route.request().method(),
        headers: {
          authorization: headers.authorization ?? "",
          "content-type": "application/json",
        },
        body: route.request().postData() ?? undefined,
      });
      await route.fulfill({
        status: resp.status,
        contentType: "application/json",
        body: await resp.text(),
      });
    });

    await page.goto("/#/login");
    await iniciarConPerfilDemo(page, /Martín Administrador/i);
    await expect(page).toHaveURL(/#\/admin/);

    // Verifica v1 inicial
    const activaCard = page.getByTestId("admin-regla-activa");
    await expect(activaCard).toContainText("v1");
    await expect(activaCard).toContainText("sistema");
    await expect(page.getByText(/Regla de tarifa/i)).toBeVisible();

    // Edita multiplicador máximo y último tramo de demanda
    await page.getByLabel("Multiplicador máximo").fill("2.5");
    await page.getByLabel("Multiplicador tramo 4").fill("1.45");
    await page.getByRole("button", { name: "Publicar nueva versión" }).click();

    // Verifica v2 publicada con autor del JWT y conservación de v1
    await expect(activaCard).toContainText("v2");
    await expect(activaCard).toContainText("99999999-9999-4999-8999-999999999999");
    await expect(page.getByText(/Regla v2 publicada/i)).toBeVisible();
    await expect(page.locator("table").getByText("Histórica")).toBeVisible();

    // Verifica que el cliente nunca envió autor, version, fecha ni precio
    expect(payloadsEnviados.length).toBe(1);
    const enviado = payloadsEnviados[0]!;
    expect(enviado.autor).toBeUndefined();
    expect(enviado.version).toBeUndefined();
    expect(enviado.creada_en).toBeUndefined();
    expect(enviado.precio).toBeUndefined();
    expect(enviado.tarifa_base_pesos).toBeUndefined();

    // Si intenta enviar curva no monótona, backend devuelve 422 REGLA_INVALIDA y se muestra alerta
    await page.getByLabel("Multiplicador tramo 1").fill("1.9");
    await page.getByRole("button", { name: "Publicar nueva versión" }).click();
    await expect(page.getByRole("alert").first()).toContainText("REGLA_INVALIDA");
  });
});
