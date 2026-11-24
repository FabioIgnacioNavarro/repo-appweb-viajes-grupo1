import { expect, test, type Page } from "@playwright/test";
import { iniciarConPerfilDemo } from "./ayudantes-login";

const TOKEN_PASAJERO =
  "eyJhbGciOiJSUzI1NiJ9." +
  Buffer.from(
    JSON.stringify({
      sub: "22222222-2222-4222-8222-222222222222",
      idUsuario: "22222222-2222-4222-8222-222222222222",
      rol: "PASAJERO",
      name: "Ana Gómez",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString("base64url") +
  ".firma-demo";

const PNG_TRANSPARENTE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

function codificarPolilinea(puntos: Array<[number, number]>, precision = 6): string {
  const factor = 10 ** precision;
  let salida = "";
  let latPrev = 0;
  let lngPrev = 0;

  const escribirValor = (delta: number) => {
    let v = delta < 0 ? ~(delta << 1) : delta << 1;
    while (v >= 0x20) {
      salida += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    salida += String.fromCharCode(v + 63);
  };

  for (const [lat, lng] of puntos) {
    const latInt = Math.round(lat * factor);
    const lngInt = Math.round(lng * factor);
    escribirValor(latInt - latPrev);
    escribirValor(lngInt - lngPrev);
    latPrev = latInt;
    lngPrev = lngInt;
  }

  return salida;
}

const POLILINEA_RESISTENCIA = codificarPolilinea([
  [-27.45213, -58.98738],
  [-27.4485, -58.9825],
  [-27.439, -58.972],
  [-27.43159, -58.96306],
]);

async function prepararMocksBase(page: Page): Promise<{
  estimacionesRecibidas: Array<Record<string, unknown>>;
  geocodificacionesInversas: Array<{ latitud: number; longitud: number }>;
  confirmacionesRecibidas: Array<{ idEstimacion?: string; claveIdempotencia?: string }>;
}> {
  const estimacionesRecibidas: Array<Record<string, unknown>> = [];
  const geocodificacionesInversas: Array<{ latitud: number; longitud: number }> = [];
  const confirmacionesRecibidas: Array<{ idEstimacion?: string; claveIdempotencia?: string }> = [];

  let contadorEstimacion = 0;
  let contadorGeo = 0;
  let viajeActual: Record<string, unknown> | null = null;

  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_TRANSPARENTE })
  );

  await page.route("**/auth/token", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: TOKEN_PASAJERO,
        id_usuario: "22222222-2222-4222-8222-222222222222",
        rol: "pasajero",
      }),
    })
  );

  await page.route("**/tarifas/geocodificacion-inversa", async (route) => {
    const body = route.request().postDataJSON() as { latitud: number; longitud: number };
    geocodificacionesInversas.push(body);
    contadorGeo += 1;
    const direccion =
      contadorGeo === 1 ? "Pellegrini 373, Resistencia" : "French 617, Resistencia";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ direccion, coordenada: body }),
    });
  });

  await page.route("**/viajes/estimacion", async (route) => {
    const body = route.request().postDataJSON() as {
      origen: { latitud?: number; longitud?: number; direccion?: string };
      destino: { latitud?: number; longitud?: number; direccion?: string };
    };
    estimacionesRecibidas.push(body);
    contadorEstimacion += 1;

    const origen =
      typeof body.origen.latitud === "number" && typeof body.origen.longitud === "number"
        ? { latitud: body.origen.latitud, longitud: body.origen.longitud }
        : { latitud: -27.45213, longitud: -58.98738 };

    const destino =
      typeof body.destino.latitud === "number" && typeof body.destino.longitud === "number"
        ? { latitud: body.destino.latitud, longitud: body.destino.longitud }
        : { latitud: -27.43159, longitud: -58.96306 };

    const ahora = Date.now();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id_estimacion: `est-web-009-${contadorEstimacion}`,
        precio_estimado: "4721",
        moneda: "ARS",
        distancia_metros: 3041,
        duracion_segundos: 317,
        proveedor_ruta: "OSRM",
        multiplicador_demanda: 1.36,
        zona: "Resistencia",
        factores_precio: {
          llueve: false,
          choferes_disponibles: 4,
          solicitudes_activas: 7,
          franja_horaria: "noche",
        },
        version_regla: 1,
        creada_en: new Date(ahora).toISOString(),
        vigente_hasta: new Date(ahora + 180_000).toISOString(),
        origen,
        destino,
        polilinea: POLILINEA_RESISTENCIA,
      }),
    });
  });

  await page.route("**/viajes/*/cancelacion", async (route) => {
    if (viajeActual) {
      viajeActual = { ...viajeActual, estado: "cancelado_por_pasajero" };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(viajeActual),
    });
  });

  await page.route("**/viajes", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ viajes: viajeActual ? [viajeActual] : [] }),
      });
      return;
    }

    const body = route.request().postDataJSON() as { id_estimacion?: string };
    const clave = await route.request().headerValue("clave-idempotencia");
    confirmacionesRecibidas.push({
      idEstimacion: body.id_estimacion,
      claveIdempotencia: clave ?? undefined,
    });

    viajeActual = {
      id_viaje: "viaje-web-009-1",
      id_estimacion: body.id_estimacion ?? "est-web-009-1",
      precio_estimado: "4721",
      precio_final: null,
      moneda: "ARS",
      multiplicador_demanda: 1.36,
      factores_precio: { franja_horaria: "noche" },
      estado: "solicitado",
      creado_en: new Date().toISOString(),
      origen: { latitud: -27.45213, longitud: -58.98738 },
      destino: { latitud: -27.43159, longitud: -58.96306 },
    };

    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(viajeActual),
    });
  });

  return { estimacionesRecibidas, geocodificacionesInversas, confirmacionesRecibidas };
}

test.describe("WEB-009 / TEST-002 - Flujo de Pasajero: destino vacío, cálculo automático y mapa interactivo", () => {
  test("destino arranca vacío con un pin A, calcula precio automáticamente al escribir y confirma/cancela viaje", async ({
    page,
  }) => {
    const registro = await prepararMocksBase(page);

    await page.goto("/#/login");
    await iniciarConPerfilDemo(page, /Ana Gómez/i);
    await expect(page).toHaveURL(/#\/pasajero/);

    const inputOrigen = page.locator("#origen-viaje");
    const inputDestino = page.locator("#destino-viaje");

    await expect(inputOrigen).toHaveValue("Juan B. Justo 4, Resistencia");
    await expect(inputDestino).toHaveValue("");
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /Calcular precio/i })).toHaveCount(0);

    await inputDestino.fill("Shopping Sarmiento, Resistencia");

    const botonConfirmar = page.getByRole("button", { name: /^Confirmar viaje$/i });
    await expect(botonConfirmar).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /congelar precio/i })).toHaveCount(0);
    await expect(page.getByText("$ 4.721 ARS")).toBeVisible();
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(2);
    await expect(page.locator("svg path.leaflet-interactive")).toHaveCount(1);

    expect(registro.estimacionesRecibidas).toHaveLength(1);
    expect(registro.estimacionesRecibidas[0]).toEqual({
      origen: { direccion: "Juan B. Justo 4, Resistencia" },
      destino: { direccion: "Shopping Sarmiento, Resistencia" },
    });

    await botonConfirmar.click();
    await expect(page.getByRole("heading", { name: /Viaje confirmado/i })).toBeVisible();
    expect(registro.confirmacionesRecibidas).toHaveLength(1);
    expect(registro.confirmacionesRecibidas[0]?.idEstimacion).toBe("est-web-009-1");
    expect(registro.confirmacionesRecibidas[0]?.claveIdempotencia).toBeTruthy();

    const botonCancelar = page.getByRole("button", { name: /Cancelar viaje/i });
    await expect(botonCancelar).toBeEnabled();
    await botonCancelar.click();
    await expect(page.getByText("El viaje fue cancelado.")).toBeVisible();
  });

  test("clic en mapa y arrastre de pin A resuelven dirección legible vía geocodificación inversa y recalculan ruta", async ({
    page,
  }) => {
    const registro = await prepararMocksBase(page);

    await page.goto("/#/login");
    await iniciarConPerfilDemo(page, /Ana Gómez/i);
    await expect(page).toHaveURL(/#\/pasajero/);
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);

    const mapa = page.locator(".leaflet-container");
    await mapa.scrollIntoViewIfNeeded();
    const mapaBox = await mapa.boundingBox();
    expect(mapaBox).not.toBeNull();

    // Clic en el mapa -> fija destino B, resuelve dirección y cotiza automáticamente
    await page.mouse.click(mapaBox!.x + mapaBox!.width * 0.68, mapaBox!.y + mapaBox!.height * 0.32);

    await expect(page.locator("#destino-viaje")).toHaveValue("Pellegrini 373, Resistencia", {
      timeout: 5000,
    });
    await expect(page.getByRole("button", { name: /^Confirmar viaje$/i })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(2);
    await expect(page.locator("svg path.leaflet-interactive")).toHaveCount(1);
    expect(registro.geocodificacionesInversas).toHaveLength(1);

    // Esperar a que termine la animación fitBounds sobre pin A antes de arrastrarlo
    const pinA = page.locator(".leaflet-marker-icon").first();
    await pinA.scrollIntoViewIfNeeded();
    let ultimaPos = "";
    await expect
      .poll(
        async () => {
          const box = await pinA.boundingBox();
          const actual = box ? `${Math.round(box.x)}:${Math.round(box.y)}` : "";
          const estable = actual.length > 0 && actual === ultimaPos;
          ultimaPos = actual;
          return estable;
        },
        { intervals: [150, 200, 250], timeout: 5000 }
      )
      .toBe(true);

    await pinA.scrollIntoViewIfNeeded();
    const boxPinA = await pinA.boundingBox();
    expect(boxPinA).not.toBeNull();

    await page.mouse.move(boxPinA!.x + boxPinA!.width / 2, boxPinA!.y + boxPinA!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      boxPinA!.x + boxPinA!.width / 2 + 45,
      boxPinA!.y + boxPinA!.height / 2 - 20,
      { steps: 8 }
    );
    await page.mouse.up();

    await expect(page.locator("#origen-viaje")).toHaveValue("French 617, Resistencia", {
      timeout: 5000,
    });
    await expect
      .poll(() => registro.estimacionesRecibidas.length, { timeout: 5000 })
      .toBeGreaterThanOrEqual(2);
  });

  test("vista de pasajero sin desborde horizontal en 360px, 768px y 1024px", async ({ page }) => {
    await prepararMocksBase(page);
    await page.goto("/#/login");
    await iniciarConPerfilDemo(page, /Ana Gómez/i);
    await expect(page).toHaveURL(/#\/pasajero/);

    await page.locator("#destino-viaje").fill("Shopping Sarmiento, Resistencia");
    await expect(page.getByRole("button", { name: /^Confirmar viaje$/i })).toBeVisible({
      timeout: 5000,
    });

    for (const viewport of [
      { width: 360, height: 640 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      const sinDesborde = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      );
      expect(sinDesborde, `Desborde horizontal en ${viewport.width}px`).toBe(true);
    }
  });
});
