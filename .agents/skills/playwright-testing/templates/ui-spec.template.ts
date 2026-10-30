import { test, expect } from "@playwright/test";

test.describe("Demostración Web - Simulador de Recorrido", () => {
  test.beforeEach(async ({ page }) => {
    // Interceptar CDN externas para soportar ejecución offline determinística
    await page.route("**/unpkg.com/**", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    await page.route("**/tile.openstreetmap.org/**", route => route.fulfill({ status: 200, body: "" }));

    // Mock liviano de Leaflet para garantizar ejecución en entornos sin salida a internet
    await page.addInitScript(() => {
      const dummyLayer = {
        addTo: function() { return this; },
        bindPopup: function() { return this; },
        getBounds: () => [[-27.45, -58.98], [-27.46, -58.99]]
      };
      (window as any).L = {
        map: () => ({
          setView: function() { return this; },
          removeLayer: () => {},
          fitBounds: () => {}
        }),
        control: { zoom: () => dummyLayer },
        tileLayer: () => dummyLayer,
        divIcon: () => ({}),
        marker: () => dummyLayer,
        polyline: () => dummyLayer
      };
    });

    await page.goto("/");
  });

  test("debe permitir calcular un recorrido y avanzar las etapas", async ({ page }) => {
    // 1. Verificar estado inicial
    await expect(page.locator("#nombre-estado")).toHaveText("Sin iniciar");
    await expect(page.locator("#boton-avanzar")).toBeDisabled();

    // 2. Ingresar coordenadas o usar las predeterminadas y calcular
    await page.locator("#boton-calcular").click();

    // 3. Esperar que se calcule la ruta y el precio
    await expect(page.locator("#precio-estimado")).not.toHaveText("—", { timeout: 10000 });
    await expect(page.locator("#boton-avanzar")).toBeEnabled();

    // 4. Solicitar y avanzar etapas
    await page.locator("#boton-avanzar").click();
    await expect(page.locator("#nombre-estado")).toHaveText("Solicitado");

    await page.locator("#boton-avanzar").click();
    await expect(page.locator("#nombre-estado")).toHaveText("Asignado");
  });
});
