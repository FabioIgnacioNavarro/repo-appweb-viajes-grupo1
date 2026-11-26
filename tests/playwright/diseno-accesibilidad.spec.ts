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

  test("WEB-010: selector de modo claro/oscuro cambia clases .dark y colores reales aunque el SO esté en oscuro", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/#/login");
    await page.evaluate(() => window.localStorage.setItem("tema_color", "claro"));
    await page.reload();

    const fondoCss = () => page.locator("#root > div").evaluate((el) => getComputedStyle(el).backgroundColor);

    const botonTema = page.getByTestId("boton-tema");
    await expect(botonTema).toBeVisible();

    // En modo claro (aunque SO esté dark), NO tiene .dark y conserva fondo claro
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
    const bgClaro = await fondoCss();
    expect(bgClaro).not.toBe("rgb(2, 6, 23)"); // no bg-slate-950

    // Click alterna a oscuro y cambia el fondo computado a dark
    await botonTema.click();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    expect(await page.evaluate(() => window.localStorage.getItem("tema_color"))).toBe("oscuro");
    await expect.poll(fondoCss).toMatch(/okl(ab|ch)\(0\.129\b|rgb\(2,\s*6,\s*23\)/); // slate-950
    expect(await fondoCss()).not.toBe(bgClaro);

    // Click de nuevo vuelve a claro y restaura el fondo claro
    await botonTema.click();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
    expect(await page.evaluate(() => window.localStorage.getItem("tema_color"))).toBe("claro");
    await expect.poll(fondoCss).toBe(bgClaro);
  });
});
