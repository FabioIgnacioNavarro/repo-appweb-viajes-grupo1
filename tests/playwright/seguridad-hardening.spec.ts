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

test.describe("SEG-003 / SEG-005 - Hardening del front y CSP", () => {
  test("escapa XSS, evita exponer JWT y mantiene el mapa sin violaciones CSP", async ({ page }) => {
    const violacionesCsp: string[] = [];
    const politicasRecibidas: string[] = [];
    await page.exposeFunction("registrarViolacionCsp", (violacion: string) => {
      violacionesCsp.push(violacion);
    });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (evento) => {
        const registrar = (window as unknown as { registrarViolacionCsp?: (valor: string) => Promise<void> })
          .registrarViolacionCsp;
        void registrar?.(`${evento.violatedDirective}: ${evento.blockedURI}`);
      });
    });
    page.on("console", (mensaje) => {
      if (mensaje.type() === "error" && /content security policy|violates the following/i.test(mensaje.text())) {
        violacionesCsp.push(mensaje.text());
      }
    });
    page.on("response", (respuesta) => {
      if (respuesta.request().isNavigationRequest()) {
        const politica = respuesta.headers()["content-security-policy"];
        if (politica) politicasRecibidas.push(politica);
      }
    });

    const payloadXssImg = `<img src=x onerror="window.__xssDisparado='img'">`;
    const payloadXssScript = `<script>window.__xssDisparado='script'</script>`;
    const wsUrls: string[] = [];
    let solicitudesTiles = 0;
    const tokenSoporte = emitirJwt("op-1", "SOPORTE", "Lucía Operaciones");
    const tokenAdmin = emitirJwt("adm-1", "ADMINISTRADOR", "Martín Admin");
    const tokenChofer = emitirJwt("cho-1", "CHOFER", "Carlos Maidana");
    const tokenPasajero = emitirJwt("pas-1", "PASAJERO", `Ana ${payloadXssImg}`);

    page.on("websocket", (ws) => {
      wsUrls.push(ws.url());
    });

    await page.route("**/auth/token", async (route) => {
      const body = route.request().postDataJSON() as { rol?: string };
      const rol = (body.rol ?? "pasajero").toLowerCase();
      const token =
        rol === "soporte"
          ? tokenSoporte
          : rol === "administrador"
            ? tokenAdmin
            : rol === "chofer"
              ? tokenChofer
              : tokenPasajero;
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
    await page.route("**/choferes/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ofertas: [] }) })
    );
    await page.route("https://tile.openstreetmap.org/**", async (route) => {
      solicitudesTiles += 1;
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=",
          "base64"
        ),
      });
    });

    // 1. Verificar Operador con datos con payloads XSS -> escapado como texto, sin ejecución
    await page.goto("/#/login");
    await iniciarConPerfilDemo(page, /Lucía Operaciones/i);
    await expect(page).toHaveURL(/#\/operador/);
    const filaXss = page.getByRole("row").filter({ hasText: payloadXssImg });
    await expect(filaXss).toBeVisible();
    await expect(filaXss).toContainText(payloadXssScript);

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
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await page.locator(".leaflet-container").click();
    await expect(page.locator(".custom-leaflet-pin").first()).toBeVisible();
    await expect.poll(() => solicitudesTiles).toBeGreaterThan(0);
    await expect
      .poll(() =>
        page
          .locator(".custom-leaflet-pin > div")
          .first()
          .evaluate((pin) => getComputedStyle(pin).width)
      )
      .toBe("32px");
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

    await page.getByRole("button", { name: "Salir" }).click();
    await iniciarConPerfilDemo(page, /Carlos Maidana/i);
    await expect(page).toHaveURL(/#\/chofer/);
    await expect(page.getByRole("banner")).toContainText("CHOFER");
    await page.goto("/#/admin");
    await expect(page).toHaveURL(/#\/no_autorizado/);
    await expect(page.getByTestId("vista-no-autorizado")).toBeVisible();

    // Repetir el recorrido con el tema oscuro ya integrado por WEB-010.
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/#\/login/);
    await page.getByTestId("boton-tema").click();
    await expect.poll(() => page.locator("html").evaluate((raiz) => raiz.classList.contains("dark"))).toBe(true);

    await iniciarConPerfilDemo(page, /Lucía Operaciones/i);
    await expect(page).toHaveURL(/#\/operador/);
    await page.getByRole("button", { name: "Salir" }).click();
    await iniciarConPerfilDemo(page, /Martín Administrador/i);
    await expect(page).toHaveURL(/#\/admin/);
    await page.locator("nav").getByRole("button", { name: "Pasajero" }).click();
    await expect(page).toHaveURL(/#\/pasajero/);
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await expect.poll(() => page.locator(".leaflet-tile").evaluateAll((tiles) =>
      tiles.filter((tile) => tile instanceof HTMLImageElement && tile.complete && tile.naturalWidth > 0).length
    )).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Salir" }).click();
    await iniciarConPerfilDemo(page, /Carlos Maidana/i);
    await expect(page).toHaveURL(/#\/chofer/);
    await expect(page.getByRole("banner")).toContainText("CHOFER");
    expect(await page.locator("html").evaluate((raiz) => raiz.classList.contains("dark"))).toBe(true);

    if (process.env.PLAYWRIGHT_REQUIRE_CSP === "1") {
      expect(politicasRecibidas.some((politica) => politica.includes("default-src 'self'"))).toBe(true);
      expect(politicasRecibidas.some((politica) => /'unsafe-inline'|'unsafe-eval'/.test(politica))).toBe(false);
    }
    expect(violacionesCsp).toEqual([]);
  });
});
