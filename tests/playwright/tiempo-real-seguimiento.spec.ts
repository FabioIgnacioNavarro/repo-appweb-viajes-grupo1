import { test, expect } from "@playwright/test";

test.describe("WEB-007 - Seguimiento en vivo con WebSocket, reconexión y resiliencia (Tema 20)", () => {
  const tokenPrueba =
    "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwicm9sIjoiQ0hPRkVSIn0";

  test.beforeEach(async ({ page }) => {
    // Interceptar login con token falso determinista
    await page.route("**/auth/token", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token: tokenPrueba }),
      })
    );

    // Mock de perfil de chofer en ms-flota
    await page.route("**/choferes/11111111-1111-4111-8111-111111111111", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chofer: {
            id: "11111111-1111-4111-8111-111111111111",
            usuario_id: "11111111-1111-4111-8111-111111111111",
            habilitado: true,
            disponibilidad: true,
            carnet_conducir_validado: true,
          },
          ubicacion: null,
        }),
      })
    );

    await page.route("**/choferes/yo/disponibilidad", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          usuario_id: "11111111-1111-4111-8111-111111111111",
          habilitado: true,
          disponibilidad: true,
          carnet_conducir_validado: true,
        }),
      });
    });

    await page.route("**/choferes/yo/ofertas", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ofertas: [] }),
      });
    });

    await page.route("**/viajes", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ viajes: [] }),
      });
    });
  });

  test("indicador de tiempo real: muestra badge WebSocket, contador y controles de simulación", async ({ page }) => {
    // 1. Interceptar WebSocket
    await page.routeWebSocket("**/ws", (ws) => {
      ws.send(
        JSON.stringify({
          tipo: "CANAL_LISTO",
          evento: "CANAL_LISTO",
          datos: { id_usuario: "11111111-1111-4111-8111-111111111111" },
        })
      );
    });

    // 2. Ingresar como chofer
    await page.goto("/#login");
    await page.getByRole("button", { name: /Carlos Maidana/i }).click();
    await expect(page.getByTestId("vista-chofer")).toBeVisible();

    // 3. Verificar que el componente IndicadorConexionTiempoReal se visualiza correctamente
    const contenedor = page.getByTestId("indicador-tiempo-real-completo");
    await expect(contenedor).toBeVisible();

    const badge = page.getByTestId("badge-estado-ws");
    await expect(badge).toContainText(/WebSocket Activo/i, { timeout: 10000 });

    // Controles de simulación de corte y reconexión
    const btnCorte = page.getByTestId("boton-simular-corte-red");
    await expect(btnCorte).toBeEnabled();

    // Simular corte voluntario
    await btnCorte.click();
    await expect(badge).toContainText(/Desconectado/i);

    // Reconectar
    const btnReconectar = page.getByTestId("boton-reconectar-ws");
    await expect(btnReconectar).toBeEnabled();
    await btnReconectar.click();
    await expect(badge).toContainText(/WebSocket Activo/i, { timeout: 10000 });
  });

  test("notificación en tiempo real sin polling: recepción de oferta y actualización de viaje vía WebSocket", async ({
    page,
  }) => {
    let wsConexion: any;

    await page.routeWebSocket("**/ws", (ws) => {
      wsConexion = ws;
      ws.send(
        JSON.stringify({
          tipo: "CANAL_LISTO",
          evento: "CANAL_LISTO",
          datos: { id_usuario: "11111111-1111-4111-8111-111111111111" },
        })
      );
    });

    await page.goto("/#login");
    await page.getByRole("button", { name: /Carlos Maidana/i }).click();
    await expect(page.getByTestId("vista-chofer")).toBeVisible();

    // Asegurar disponibilidad activa
    const btnDisp = page.getByTestId("boton-toggle-disponibilidad");
    await expect(btnDisp).toBeVisible();
    if (await btnDisp.innerText().then((txt) => txt.includes("No disponible"))) {
      await btnDisp.click();
      await expect(btnDisp).toHaveText("Disponible (Activo)");
    }

    // Esperar a que el canal WebSocket esté activo
    await expect(page.getByTestId("badge-estado-ws")).toContainText(/WebSocket Activo/i, { timeout: 10000 });

    // Enviar evento de oferta entrante sin realizar polling HTTP
    expect(wsConexion).toBeDefined();
    wsConexion.send(
      JSON.stringify({
        tipo: "OFERTA_NUEVA",
        evento: "OFERTA_NUEVA",
        datos: {
          id_oferta: "oferta-ws-777",
          id_viaje: "viaje-ws-888",
          expira_en: new Date(Date.now() + 60_000).toISOString(),
          precio_estimado: "5500",
          origen: { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo" },
          destino: { latitud: -27.4598, longitud: -58.9789, direccion: "Campus UNNE" },
        },
      })
    );

    // Verificar que la oferta se refleja inmediatamente en la interfaz
    const tarjeta = page.getByTestId("tarjeta-oferta-oferta-ws-777");
    await expect(tarjeta).toBeVisible({ timeout: 5000 });
    await expect(tarjeta).toContainText("5");

    // Mock para aceptar la oferta
    await page.route("**/choferes/yo/ofertas/oferta-ws-777/aceptacion", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id_viaje: "viaje-ws-888",
          pasajero_id: "pasajero-456",
          chofer_id: "11111111-1111-4111-8111-111111111111",
          origen: { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo" },
          destino: { latitud: -27.4598, longitud: -58.9789, direccion: "Campus UNNE" },
          precio_estimado: "5500",
          precio_final: null,
          moneda: "ARS",
          estado: "asignado",
          creado_en: new Date().toISOString(),
        }),
      })
    );

    // Mock para consulta de viaje
    await page.route("**/viajes/viaje-ws-888", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id_viaje: "viaje-ws-888",
          pasajero_id: "pasajero-456",
          chofer_id: "11111111-1111-4111-8111-111111111111",
          origen: { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo" },
          destino: { latitud: -27.4598, longitud: -58.9789, direccion: "Campus UNNE" },
          precio_estimado: "5500",
          precio_final: null,
          moneda: "ARS",
          estado: "asignado",
        }),
      })
    );

    await page.getByTestId("boton-aceptar-oferta-ws-777").click();

    // El componente de seguimiento en vivo debe aparecer
    const panelSeguimiento = page.getByTestId("panel-seguimiento-tiempo-real");
    await expect(panelSeguimiento).toBeVisible();
    await expect(page.getByTestId("etapa-asignado")).toHaveClass(/ring-2|font-extrabold/);

    // Enviar evento de coordenadas en vivo vía WebSocket
    wsConexion.send(
      JSON.stringify({
        tipo: "UBICACION_CHOFER_ACTUALIZADA",
        evento: "UBICACION_CHOFER_ACTUALIZADA",
        datos: {
          latitud: -27.4533,
          longitud: -58.9822,
          actualizado_en: new Date().toISOString(),
        },
      })
    );

    await expect(page.getByTestId("latitud-chofer-ws")).toHaveText("-27.4533");
    await expect(page.getByTestId("longitud-chofer-ws")).toHaveText("-58.9822");

    // Enviar transición de estado por WebSocket (sin recargar la página)
    wsConexion.send(
      JSON.stringify({
        tipo: "ESTADO_VIAJE_ACTUALIZADO",
        evento: "ESTADO_VIAJE_ACTUALIZADO",
        datos: {
          id_viaje: "viaje-ws-888",
          estado: "chofer_en_camino",
        },
      })
    );

    await expect(page.getByTestId("etapa-chofer_en_camino")).toHaveClass(/ring-2|font-extrabold/);
  });

  test("resiliencia de red y recuperación canónica tras reconexión (GET /viajes/:id)", async ({ page }) => {
    let wsConexion: any;
    let estadoBackend = "asignado";
    let llamadasGetViaje = 0;

    await page.routeWebSocket("**/ws", (ws) => {
      wsConexion = ws;
      ws.send(
        JSON.stringify({
          tipo: "CANAL_LISTO",
          evento: "CANAL_LISTO",
          datos: { id_usuario: "11111111-1111-4111-8111-111111111111" },
        })
      );
    });

    await page.route("**/viajes/viaje-ws-999", (route) => {
      llamadasGetViaje++;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id_viaje: "viaje-ws-999",
          pasajero_id: "pasajero-456",
          chofer_id: "11111111-1111-4111-8111-111111111111",
          origen: { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo" },
          destino: { latitud: -27.4598, longitud: -58.9789, direccion: "Campus UNNE" },
          precio_estimado: "4900",
          precio_final: null,
          moneda: "ARS",
          estado: estadoBackend,
        }),
      });
    });

    await page.route("**/choferes/yo/ofertas/oferta-999/aceptacion", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id_viaje: "viaje-ws-999",
          pasajero_id: "pasajero-456",
          chofer_id: "11111111-1111-4111-8111-111111111111",
          origen: { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo" },
          destino: { latitud: -27.4598, longitud: -58.9789, direccion: "Campus UNNE" },
          precio_estimado: "4900",
          precio_final: null,
          moneda: "ARS",
          estado: "asignado",
          creado_en: new Date().toISOString(),
        }),
      })
    );

    await page.goto("/#login");
    await page.getByRole("button", { name: /Carlos Maidana/i }).click();
    await expect(page.getByTestId("vista-chofer")).toBeVisible();

    // Asegurar disponibilidad activa
    const btnDisp = page.getByTestId("boton-toggle-disponibilidad");
    await expect(btnDisp).toBeVisible();
    if (await btnDisp.innerText().then((txt) => txt.includes("No disponible"))) {
      await btnDisp.click();
      await expect(btnDisp).toHaveText("Disponible (Activo)");
    }

    // Esperar a que el canal WebSocket esté activo
    await expect(page.getByTestId("badge-estado-ws")).toContainText(/WebSocket Activo/i, { timeout: 10000 });

    // Inyectar oferta por WebSocket
    expect(wsConexion).toBeDefined();
    wsConexion.send(
      JSON.stringify({
        tipo: "OFERTA_NUEVA",
        evento: "OFERTA_NUEVA",
        datos: {
          id_oferta: "oferta-999",
          id_viaje: "viaje-ws-999",
          expira_en: new Date(Date.now() + 60_000).toISOString(),
          precio_estimado: "4900",
        },
      })
    );

    const tarjeta = page.getByTestId("tarjeta-oferta-oferta-999");
    await expect(tarjeta).toBeVisible({ timeout: 5000 });

    await page.getByTestId("boton-aceptar-oferta-999").click();
    await expect(page.getByTestId("panel-seguimiento-tiempo-real")).toBeVisible();
    await expect(page.getByTestId("etapa-asignado")).toHaveClass(/ring-2|font-extrabold/);

    // 1. Simular corte de red
    await page.getByTestId("boton-simular-corte-red").click();
    await expect(page.getByTestId("badge-estado-ws")).toContainText(/Desconectado/i);

    // 2. Mientras la red estaba caída, el backend avanzó a 'en_curso'
    estadoBackend = "en_curso";

    // 3. Reconectar socket: el cambio de estado dispara la sincronización canónica GET /viajes/:id
    const llamadasAntes = llamadasGetViaje;
    await page.getByTestId("boton-reconectar-ws").click();

    // 4. Verificar que se recuperó el estado canónico persistido
    await expect(async () => {
      expect(llamadasGetViaje).toBeGreaterThan(llamadasAntes);
    }).toPass({ timeout: 10000 });

    await expect(page.getByTestId("etapa-en_curso")).toHaveClass(/ring-2|font-extrabold/);
  });

  test("diseño responsive: el monitor y seguimiento se adaptan a 360px, 768px y 1024px", async ({ page }) => {
    await page.routeWebSocket("**/ws", (ws) => {
      ws.send(
        JSON.stringify({
          tipo: "CANAL_LISTO",
          evento: "CANAL_LISTO",
          datos: { id_usuario: "11111111-1111-4111-8111-111111111111" },
        })
      );
    });

    await page.goto("/#login");
    await page.getByRole("button", { name: /Carlos Maidana/i }).click();

    const monitor = page.getByTestId("indicador-tiempo-real-completo");

    // 1. Mobile 360px
    await page.setViewportSize({ width: 360, height: 740 });
    await expect(monitor).toBeVisible();
    const cajaMobile = await monitor.boundingBox();
    expect(cajaMobile?.width).toBeLessThanOrEqual(360);

    // 2. Tablet 768px
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(monitor).toBeVisible();

    // 3. Desktop 1024px
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(monitor).toBeVisible();
  });
});
