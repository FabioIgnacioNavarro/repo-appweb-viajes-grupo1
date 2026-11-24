import { test, expect } from "@playwright/test";
import { iniciarConPerfilDemo } from "./ayudantes-login";

test.describe("WEB-003 - Sistema de diseño responsive, accesibilidad y mapa Leaflet", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/auth/token", async (route) => {
      const body = route.request().postDataJSON() as { id_usuario?: string; idUsuario?: string; rol?: string; nombre?: string } | null;
      const rol = (body?.rol || "pasajero").toUpperCase();
      const idUsuario = body?.id_usuario || body?.idUsuario || "usuario-demo";
      const payload = {
        sub: idUsuario,
        idUsuario,
        rol,
        name: body?.nombre || rol,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = `falso.${Buffer.from(JSON.stringify({ tipo: "jwt-falso", ...payload })).toString("base64url")}`;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token }) });
    });

    await page.route("**/viajes**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ viajes: [] }) })
    );
    await page.route("**/choferes/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ofertas: [] }) })
    );
    // Evitar demora de red descargando teselas OSM en pruebas headless
    await page.route("https://tile.openstreetmap.org/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
      })
    );
  });

  test("landmarks accesibles, skip link por teclado y mapa Leaflet visible en Pasajero", async ({ page }) => {
    await page.goto("/#/login");

    // Verificar exactamente un header y un main
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);

    // Primer Tab enfoca el enlace para saltar al contenido principal
    await page.keyboard.press("Tab");
    const enfocado = page.locator(":focus");
    await expect(enfocado).toHaveText(/Saltar al contenido principal/i);

    // Ingresar como pasajero y verificar Mapa Leaflet + landmarks únicos
    await iniciarConPerfilDemo(page, /Ana Gómez/i);
    await expect(page).toHaveURL(/#\/pasajero/);
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator(".leaflet-container")).toBeVisible();
  });

  test("sin desborde horizontal en 360px, 768px y 1024px en Operador, Admin y Pasajero", async ({ page }) => {
    const viewports = [
      { ancho: 360, alto: 640 },
      { ancho: 768, alto: 1024 },
      { ancho: 1024, alto: 768 },
    ];

    await page.goto("/#/login");
    await iniciarConPerfilDemo(page, /Martín Administrador/i);
    await expect(page).toHaveURL(/#\/admin/);

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.ancho, height: vp.alto });

      for (const ruta of ["admin", "operador", "pasajero", "chofer"]) {
        await page.goto(`/#/${ruta}`);
        await page.waitForLoadState("networkidle");
        const sinDesborde = await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1
        );
        expect(sinDesborde, `Desborde horizontal en #/${ruta} a ${vp.ancho}px`).toBe(true);
      }
    }
  });

  test("WEB-010: selector de modo oscuro alterna clase dark en html y persiste en localStorage", async ({ page }) => {
    await page.goto("/#/login");

    const botonTema = page.getByTestId("boton-tema");
    await expect(botonTema).toBeVisible();

    // Estado inicial en tema claro
    const esOscuroInicial = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(esOscuroInicial).toBe(false);

    // Click alterna a oscuro
    await botonTema.click();
    const esOscuroDespues = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(esOscuroDespues).toBe(true);

    const valorStorage = await page.evaluate(() => window.localStorage.getItem("tema_color"));
    expect(valorStorage).toBe("oscuro");

    // Click de nuevo vuelve a claro
    await botonTema.click();
    const esOscuroFinal = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(esOscuroFinal).toBe(false);
    expect(await page.evaluate(() => window.localStorage.getItem("tema_color"))).toBe("claro");
  });
});
