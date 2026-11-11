import { test, expect } from "@playwright/test";

test.describe("WEB-006 - Vista del Chofer: disponibilidad, ofertas, 409 y avance de viaje", () => {
  test.beforeEach(async ({ page }) => {
    // Interceptar el intento de login al emulador para usar el token de prueba determinista de forma inmediata
    await page.route("**/auth/token", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token:
            "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwicm9sIjoiQ0hPRkVSIn0",
        }),
      })
    );
  });

  test("flujo completo de chofer: activar disponibilidad, enviar ubicación, recibir oferta de 60s, aceptarla y avanzar estados hasta finalizar", async ({
    page,
  }) => {
    let disponibilidadActual = false;
    let estadoViaje = "solicitado";

    // Mock de contratos HTTP de ms-flota y ms-viajes (según docs/api.md)
    await page.route("**/choferes/11111111-1111-4111-8111-111111111111", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chofer: {
            id: "11111111-1111-4111-8111-111111111111",
            usuario_id: "11111111-1111-4111-8111-111111111111",
            habilitado: true,
            disponibilidad: disponibilidadActual,
            carnet_conducir_validado: true,
          },
          ubicacion: null,
        }),
      })
    );

    await page.route("**/choferes/yo/disponibilidad", async (route) => {
      const body = route.request().postDataJSON() as { disponibilidad: boolean };
      disponibilidadActual = Boolean(body.disponibilidad);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          usuario_id: "11111111-1111-4111-8111-111111111111",
          habilitado: true,
          disponibilidad: disponibilidadActual,
          carnet_conducir_validado: true,
        }),
      });
    });

    await page.route("**/choferes/yo/ubicacion", async (route) => {
      const body = route.request().postDataJSON() as { latitud: number; longitud: number; actualizado_at: string };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "ubic-1",
          usuario_id: "11111111-1111-4111-8111-111111111111",
          latitud: body.latitud,
          longitud: body.longitud,
          actualizado_at: body.actualizado_at || new Date().toISOString(),
        }),
      });
    });

    const expiraEn60s = new Date(Date.now() + 59_000).toISOString();
    await page.route("**/choferes/yo/ofertas", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ofertas: disponibilidadActual
            ? [
                {
                  id_oferta: "oferta-101",
                  id_viaje: "viaje-501",
                  id_chofer: "11111111-1111-4111-8111-111111111111",
                  estado: "pendiente",
                  enviada_en: new Date().toISOString(),
                  expira_en: expiraEn60s,
                },
              ]
            : [],
        }),
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
        body: JSON.stringify({
          viajes: [
            {
              id_viaje: "viaje-501",
              pasajero_id: "pasajero-202",
              chofer_id: null,
              origen: { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo" },
              destino: { latitud: -27.4598, longitud: -58.9789, direccion: "UNNE Campus Resistencia" },
              id_estimacion: "est-900",
              precio_estimado: "4800",
              precio_final: null,
              moneda: "ARS",
              multiplicador_demanda: 1.2,
              factores_precio: {},
              estado: estadoViaje,
              creado_en: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    await page.route("**/choferes/yo/ofertas/oferta-101/aceptacion", async (route) => {
      estadoViaje = "asignado";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id_viaje: "viaje-501",
          pasajero_id: "pasajero-202",
          chofer_id: "11111111-1111-4111-8111-111111111111",
          origen: { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo" },
          destino: { latitud: -27.4598, longitud: -58.9789, direccion: "UNNE Campus Resistencia" },
          id_estimacion: "est-900",
          precio_estimado: "4800",
          precio_final: null,
          moneda: "ARS",
          multiplicador_demanda: 1.2,
          factores_precio: {},
          estado: "asignado",
          creado_en: new Date().toISOString(),
        }),
      });
    });

    await page.route("**/viajes/viaje-501/llegada", async (route) => {
      estadoViaje = "chofer_en_camino";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id_viaje: "viaje-501",
          pasajero_id: "pasajero-202",
          chofer_id: "11111111-1111-4111-8111-111111111111",
          origen: { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo" },
          destino: { latitud: -27.4598, longitud: -58.9789, direccion: "UNNE Campus Resistencia" },
          id_estimacion: "est-900",
          precio_estimado: "4800",
          precio_final: null,
          moneda: "ARS",
          multiplicador_demanda: 1.2,
          factores_precio: {},
          estado: "chofer_en_camino",
          creado_en: new Date().toISOString(),
        }),
      });
    });

    await page.route("**/viajes/viaje-501/inicio", async (route) => {
      estadoViaje = "en_curso";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id_viaje: "viaje-501",
          pasajero_id: "pasajero-202",
          chofer_id: "11111111-1111-4111-8111-111111111111",
          origen: { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo" },
          destino: { latitud: -27.4598, longitud: -58.9789, direccion: "UNNE Campus Resistencia" },
          id_estimacion: "est-900",
          precio_estimado: "4800",
          precio_final: null,
          moneda: "ARS",
          multiplicador_demanda: 1.2,
          factores_precio: {},
          estado: "en_curso",
          creado_en: new Date().toISOString(),
          iniciado_en: new Date().toISOString(),
        }),
      });
    });

    await page.route("**/viajes/viaje-501/finalizacion", async (route) => {
      estadoViaje = "finalizado";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          viaje: {
            id_viaje: "viaje-501",
            pasajero_id: "pasajero-202",
            chofer_id: "11111111-1111-4111-8111-111111111111",
            origen: { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo" },
            destino: { latitud: -27.4598, longitud: -58.9789, direccion: "UNNE Campus Resistencia" },
            id_estimacion: "est-900",
            precio_estimado: "4800",
            precio_final: "4800",
            moneda: "ARS",
            multiplicador_demanda: 1.2,
            factores_precio: {},
            estado: "finalizado",
            creado_en: new Date().toISOString(),
            finalizado_en: new Date().toISOString(),
          },
          cobro: {
            id_cobro: "cobro-901",
            importe: "4800",
            moneda: "ARS",
            estado: "confirmado",
          },
        }),
      });
    });

    // 1. Ingresar como Chofer
    await page.goto("/#login");
    await page.getByRole("button", { name: /Carlos Maidana/i }).click();
    await expect(page.getByTestId("vista-chofer")).toBeVisible();

    // 2. Activar disponibilidad en ms-flota
    const botonDisponibilidad = page.getByTestId("boton-toggle-disponibilidad");
    await expect(botonDisponibilidad).toHaveText("No disponible");
    await botonDisponibilidad.click();
    await expect(botonDisponibilidad).toHaveText("Disponible (Activo)");

    // 3. Verificar que la oferta aparece con cuenta regresiva de 60s
    await expect(page.getByTestId("tarjeta-oferta-oferta-101")).toBeVisible();
    await expect(page.getByTestId("cuenta-regresiva-oferta-101")).toContainText(/s$/);

    // 4. Enviar ubicación manual y un paso simulado GPS
    await page.getByTestId("boton-enviar-ubicacion").click();
    await expect(page.getByTestId("ultima-ubicacion-chofer")).toContainText("Posición manual");
    await page.getByTestId("boton-paso-simulacion-gps").click();
    await expect(page.getByTestId("ultima-ubicacion-chofer")).toContainText("Av. Alberdi 300");

    // 5. Aceptar la oferta y verificar que solo la transición 1 (Chofer en Camino) está habilitada
    const btnEnCamino = page.getByTestId("boton-chofer-en-camino");
    const btnIniciar = page.getByTestId("boton-iniciar-viaje");
    const btnFinalizar = page.getByTestId("boton-finalizar-viaje");
    await expect(btnEnCamino).toBeDisabled();
    await expect(btnIniciar).toBeDisabled();
    await expect(btnFinalizar).toBeDisabled();

    await page.getByTestId("boton-aceptar-oferta-101").click();
    await expect(page.getByTestId("estado-viaje-chofer")).toHaveText("Asignado (Ir a buscar pasajero)");
    await expect(btnEnCamino).toBeEnabled();
    await expect(btnIniciar).toBeDisabled();
    await expect(btnFinalizar).toBeDisabled();

    // 6. Avanzar a Chofer en Camino -> habilita Iniciar Viaje
    await btnEnCamino.click();
    await expect(page.getByTestId("estado-viaje-chofer")).toHaveText("Chofer en camino al origen");
    await expect(btnEnCamino).toBeDisabled();
    await expect(btnIniciar).toBeEnabled();
    await expect(btnFinalizar).toBeDisabled();

    // 7. Avanzar a En Curso -> habilita Finalizar y Cobrar
    await btnIniciar.click();
    await expect(page.getByTestId("estado-viaje-chofer")).toHaveText("Viaje en curso");
    await expect(btnEnCamino).toBeDisabled();
    await expect(btnIniciar).toBeDisabled();
    await expect(btnFinalizar).toBeEnabled();

    // 8. Finalizar viaje y verificar recibo de cobro
    await btnFinalizar.click();
    await expect(page.getByTestId("estado-viaje-chofer")).toHaveText("Viaje finalizado");
    await expect(page.getByTestId("resumen-cobro-chofer")).toContainText("cobro-901");
  });

  test("maneja error 409 Conflict cuando otro chofer toma la oferta primero y se ve bien en 360, 768 y 1024 px", async ({
    page,
  }) => {
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

    await page.route("**/choferes/yo/ofertas", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ofertas: [
            {
              id_oferta: "oferta-409",
              id_viaje: "viaje-409",
              id_chofer: "11111111-1111-4111-8111-111111111111",
              estado: "pendiente",
              enviada_en: new Date().toISOString(),
              expira_en: new Date(Date.now() + 50_000).toISOString(),
            },
          ],
        }),
      })
    );

    await page.route("**/viajes", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ viajes: [] }) })
    );

    // Simular que otro chofer aceptó la oferta milisegundos antes -> 409 ASIGNACION_EN_CONFLICTO
    await page.route("**/choferes/yo/ofertas/oferta-409/aceptacion", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            codigo: "ASIGNACION_EN_CONFLICTO",
            mensaje: "El viaje o el chofer ya fueron asignados.",
            detalles: {},
          },
        }),
      })
    );

    // Verificar en los 3 viewports requeridos (360px, 768px, 1024px)
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/#login");
    await page.getByRole("button", { name: /Carlos Maidana/i }).click();
    await expect(page.getByTestId("vista-chofer")).toBeVisible();

    await expect(page.getByTestId("tarjeta-oferta-oferta-409")).toBeVisible();
    await page.getByTestId("boton-aceptar-oferta-409").click();

    // Debe mostrarse el banner de conflicto 409 y el motivo en la tarjeta sin romper la pantalla
    const alerta409 = page.getByTestId("alerta-error-chofer");
    await expect(alerta409).toBeVisible();
    await expect(alerta409).toContainText("409");
    await expect(alerta409).toContainText("ASIGNACION_EN_CONFLICTO");
    await expect(page.getByTestId("motivo-oferta-oferta-409")).toContainText("Ya tomada por otro chofer");

    // Validar layout responsive en 768px y 1024px
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.getByTestId("vista-chofer")).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByTestId("vista-chofer")).toBeVisible();
  });
});
