import { test, expect } from "@playwright/test";
import { iniciarConPerfilDemo } from "./ayudantes-login";

function emitirJwt(id: string, rol: string, nombre: string): string {
  const payload = {
    sub: id,
    idUsuario: id,
    rol: rol.toUpperCase(),
    name: nombre,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  return `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firma-demo`;
}

test.describe("SEG-003 - Hardening del front: anti-XSS y sin token en URL", () => {
  test("escapa payloads XSS en tablas, formularios, alertas y MapaLeaflet sin ejecutar HTML ni exponer el JWT en URLs", async ({ page }) => {
    const payloadXssImg = `<img src=x onerror="window.__xssDisparado='img'">`;
    const payloadXssScript = `<script>window.__xssDisparado='script'</script>`;
    const wsUrls: string[] = [];
    const tokenSoporte = emitirJwt("op-1", "SOPORTE", "Lucía Operaciones");
    const tokenAdmin = emitirJwt("adm-1", "ADMINISTRADOR", "Martín Admin");
    const tokenPasajero = emitirJwt("pas-1", "PASAJERO", `Ana ${payloadXssImg}`);

    page.on("websocket", (ws) => {
      wsUrls.push(ws.url());
    });

    await page.route("**/auth/token", async (route) => {
      const body = route.request().postDataJSON() as { rol?: string };
      const rol = (body.rol ?? "pasajero").toLowerCase();
      const token =
        rol === "soporte" ? tokenSoporte : rol === "administrador" ? tokenAdmin : tokenPasajero;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token, rol }),
      });
    });

    await page.route("**/viajes", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ viajes: [] }),
      });
    });

    await page.route("**/viajes?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          viajes: [
            {
              id_viaje: "viaje-xss-1",
              pasajero_id: payloadXssImg,
              chofer_id: payloadXssScript,
              id_estimacion: "est-xss-1",
              precio_estimado: "4100",
              precio_final: "4100",
              moneda: "ARS",
              multiplicador_demanda: 1.1,
              estado: "finalizado",
              creado_en: "2026-11-19T12:00:00.000Z",
            },
          ],
          pagina: 1,
          limite: 20,
          total: 1,
        }),
      });
    });

    await page.route("**/reglas/demanda", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          activa: {
            version: 1,
            autor: payloadXssImg,
            creada_en: "2026-11-19T12:00:00.000Z",
            activa: true,
            tarifa_base_pesos: "1000",
            precio_por_kilometro_pesos: "600",
            precio_por_minuto_pesos: "120",
            multiplicador_minimo: 0.75,
            multiplicador_maximo: 2.0,
            lluvia_con_precipitacion: 1.1,
            lluvia_sin_precipitacion: 1.0,
            disponibilidad: [{ hasta: null, multiplicador: 1.0 }],
            demanda_por_mil: [{ hasta: null, multiplicador: 1.0 }],
            horario: { MADRUGADA: 1, MANANA: 1, SIESTA: 1, TARDE: 1, NOCHE: 1 },
          },
          historial: [
            {
              version: 1,
              autor: payloadXssScript,
              creada_en: "2026-11-19T12:00:00.000Z",
              activa: true,
              tarifa_base_pesos: "1000",
              precio_por_kilometro_pesos: "600",
              precio_por_minuto_pesos: "120",
              multiplicador_minimo: 0.75,
              multiplicador_maximo: 2.0,
              lluvia_con_precipitacion: 1.1,
              lluvia_sin_precipitacion: 1.0,
              disponibilidad: [{ hasta: null, multiplicador: 1.0 }],
              demanda_por_mil: [{ hasta: null, multiplicador: 1.0 }],
              horario: { MADRUGADA: 1, MANANA: 1, SIESTA: 1, TARDE: 1, NOCHE: 1 },
            },
          ],
        }),
      });
    });

    await page.route("**/ready/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ estado: "listo" }) })
    );

    // 1. Verificar Operador con datos con payloads XSS -> escapado como texto, sin ejecución
    await page.goto("/#/login");
    await iniciarConPerfilDemo(page, /Lucía Operaciones/i);
    await expect(page).toHaveURL(/#\/operador/);
    await expect(page.getByText(payloadXssImg).first()).toBeVisible();
    await expect(page.getByText(payloadXssScript).first()).toBeVisible();

    let estadoSeguridad = await page.evaluate(() => ({
      xss: (window as unknown as { __xssDisparado?: string }).__xssDisparado ?? null,
      href: window.location.href,
      imgsRotas: document.querySelectorAll("img[src='x']").length,
    }));
    expect(estadoSeguridad.xss).toBeNull();
    expect(estadoSeguridad.imgsRotas).toBe(0);
    expect(estadoSeguridad.href).not.toContain(tokenSoporte);

    await page.getByRole("button", { name: "Salir" }).click();

    // 2. Verificar Administrador con campo autor XSS -> escapado como texto, sin ejecución
    await iniciarConPerfilDemo(page, /Martín Administrador/i);
    await expect(page).toHaveURL(/#\/admin/);
    await expect(page.getByText(payloadXssImg).first()).toBeVisible();

    // También navegar a Pasajero (mapa Leaflet + WebSocket) y confirmar ausencia de XSS y token fuera de URL
    await page.locator("nav").getByRole("button", { name: "Pasajero" }).click();
    await expect(page).toHaveURL(/#\/pasajero/);
    await page.reload();
    await expect(page).toHaveURL(/#\/pasajero/);
    await expect.poll(() => wsUrls.filter((u) => u.includes("/ws") || u.includes("/tiempo-real")).length).toBeGreaterThan(0);

    estadoSeguridad = await page.evaluate(() => ({
      xss: (window as unknown as { __xssDisparado?: string }).__xssDisparado ?? null,
      href: window.location.href,
      imgsRotas: document.querySelectorAll("img[src='x']").length,
    }));
    expect(estadoSeguridad.xss).toBeNull();
    expect(estadoSeguridad.imgsRotas).toBe(0);
    expect(estadoSeguridad.href).not.toContain(tokenAdmin);
    expect(estadoSeguridad.href).not.toContain(tokenPasajero);
    const wsApp = wsUrls.filter((u) => u.includes("/ws") || u.includes("/tiempo-real"));
    for (const wsUrl of wsApp) {
      expect(wsUrl).not.toContain("eyJhbGci");
      expect(wsUrl).not.toContain("token=");
    }
  });
});
