import { test, expect } from "@playwright/test";

test.describe("Simulador Web - Flujo de Recorrido y Estados", () => {
  test.beforeEach(async ({ page }) => {
    // Interceptar CDN externas para soportar ejecución offline
    await page.route("**/unpkg.com/**", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    await page.route("**/tile.openstreetmap.org/**", route => route.fulfill({ status: 200, body: "" }));

    // Mock completo de Leaflet para garantizar ejecución fluida y 100% offline
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

  test("debe cargar la interfaz con los valores iniciales correctos", async ({ page }) => {
    // Título y encabezado
    await expect(page).toHaveTitle(/Viajes · Demo de recorrido/);
    await expect(page.locator("#nombre-estado")).toHaveText("Sin iniciar");

    // Botón avanzar deshabilitado al inicio
    const botonAvanzar = page.locator("#boton-avanzar");
    await expect(botonAvanzar).toBeDisabled();

    // Valores por defecto en las coordenadas
    await expect(page.locator("#latitud-origen")).toHaveValue("-27.451");
    await expect(page.locator("#longitud-origen")).toHaveValue("-58.986");
    await expect(page.locator("#latitud-destino")).toHaveValue("-27.462");
    await expect(page.locator("#longitud-destino")).toHaveValue("-58.993");
  });

  test("debe calcular el recorrido, mostrar precio estimado y completar todas las etapas del viaje", async ({ page }) => {
    // 1. Calcular recorrido
    const botonCalcular = page.locator("#boton-calcular");
    await expect(botonCalcular).toBeEnabled();
    await botonCalcular.click();

    // 2. Esperar respuesta de estimación y actualización de UI
    const precioEstimado = page.locator("#precio-estimado");
    await expect(precioEstimado).not.toHaveText("—", { timeout: 10000 });
    await expect(page.locator("#distancia-ruta")).not.toHaveText("—");
    await expect(page.locator("#duracion-ruta")).not.toHaveText("—");

    // 3. El botón para avanzar de etapa debe quedar habilitado
    const botonAvanzar = page.locator("#boton-avanzar");
    await expect(botonAvanzar).toBeEnabled();
    await expect(botonAvanzar).toHaveText(/Solicitar viaje de prueba/);

    // 4. Etapa 1: Solicitado
    await botonAvanzar.click();
    await expect(page.locator("#nombre-estado")).toHaveText("Solicitado");

    // 5. Etapa 2: Asignado
    await botonAvanzar.click();
    await expect(page.locator("#nombre-estado")).toHaveText("Asignado");

    // 6. Etapa 3: En curso
    await botonAvanzar.click();
    await expect(page.locator("#nombre-estado")).toHaveText("En curso");

    // 7. Etapa 4: Finalizado
    await botonAvanzar.click();
    await expect(page.locator("#nombre-estado")).toHaveText("Finalizado");
    await expect(botonAvanzar).toBeDisabled();
  });

  test("debe permitir reiniciar la simulación restableciendo el viaje a 'Sin iniciar'", async ({ page }) => {
    // 1. Iniciar cálculo y solicitar viaje
    await page.locator("#boton-calcular").click();
    const botonAvanzar = page.locator("#boton-avanzar");
    await expect(botonAvanzar).toBeEnabled({ timeout: 10000 });
    await botonAvanzar.click();
    await expect(page.locator("#nombre-estado")).toHaveText("Solicitado");

    // 2. Presionar reiniciar simulación
    await page.locator("#boton-reiniciar").click();

    // 3. Verificar que vuelve a estado 'Sin iniciar' y permite volver a solicitar el viaje
    await expect(page.locator("#nombre-estado")).toHaveText("Sin iniciar");
    await expect(botonAvanzar).toHaveText(/Solicitar viaje de prueba/);
    await expect(page.locator("#mensaje-ruta")).toHaveText(/Simulación reiniciada/);
  });
});
