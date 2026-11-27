import { expect, test, type Page } from "@playwright/test";

const EJECUTAR_FLUJO_REAL = process.env.PLAYWRIGHT_FLUJO_REAL === "1";
const MAXIMIZADO = process.env.PLAYWRIGHT_MAXIMIZED === "1";
const PASSWORD_DEMO = process.env.AUTH_DEMO_PASSWORD || "ViajesDemo2026!";
const PAUSA_DEMO_MS = Math.max(0, Number(process.env.DEMO_PAUSA_MS || "0") || 0);
const PASO_GPS_MS = PAUSA_DEMO_MS > 0 ? 450 : 0;

interface Coordenada {
  latitud: number;
  longitud: number;
}

interface EstimacionReal {
  origen: Coordenada;
  destino: Coordenada;
  polilinea?: string | null;
  proveedor_ruta?: "OSRM" | "GOOGLE" | "HAVERSINE";
}

async function pausaVisual(multiplicador = 1): Promise<void> {
  if (PAUSA_DEMO_MS <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.round(PAUSA_DEMO_MS * multiplicador)));
}

function decodificarPolilinea(polilinea: string, precision: number): Coordenada[] {
  const puntos: Coordenada[] = [];
  let indice = 0;
  let latitud = 0;
  let longitud = 0;

  const leerDelta = (): number => {
    let resultado = 0;
    let desplazamiento = 0;
    let continuar: number;
    do {
      continuar = polilinea.charCodeAt(indice++) - 63;
      resultado |= (continuar & 0x1f) << desplazamiento;
      desplazamiento += 5;
    } while (continuar >= 0x20);
    return resultado & 1 ? ~(resultado >> 1) : resultado >> 1;
  };

  while (indice < polilinea.length) {
    latitud += leerDelta();
    longitud += leerDelta();
    puntos.push({ latitud: latitud / 10 ** precision, longitud: longitud / 10 ** precision });
  }
  return puntos;
}

function extraerPuntosRutaCalculada(estimacion: EstimacionReal): Coordenada[] {
  if (estimacion.polilinea && estimacion.proveedor_ruta !== "HAVERSINE") {
    const precisiones =
      estimacion.proveedor_ruta === "GOOGLE"
        ? [5]
        : estimacion.proveedor_ruta === "OSRM"
          ? [6]
          : [6, 5];
    let mejor: { puntos: Coordenada[]; error: number } | null = null;
    for (const precision of precisiones) {
      try {
        const puntos = decodificarPolilinea(estimacion.polilinea, precision);
        if (puntos.length < 2) continue;
        const error =
          Math.abs(puntos[0].latitud - estimacion.origen.latitud) +
          Math.abs(puntos[0].longitud - estimacion.origen.longitud) +
          Math.abs(puntos[puntos.length - 1].latitud - estimacion.destino.latitud) +
          Math.abs(puntos[puntos.length - 1].longitud - estimacion.destino.longitud);
        if (!mejor || error < mejor.error) {
          mejor = { puntos, error };
        }
      } catch {
        // Ignorar precisión incompatible
      }
    }
    if (mejor && mejor.puntos.length >= 2) return mejor.puntos;
  }
  return interpolarPuntos(estimacion.origen, estimacion.destino, 6);
}

function interpolarPuntos(inicio: Coordenada, fin: Coordenada, pasos: number): Coordenada[] {
  const resultado: Coordenada[] = [];
  for (let i = 1; i <= pasos; i++) {
    const t = i / pasos;
    resultado.push({
      latitud: inicio.latitud + (fin.latitud - inicio.latitud) * t,
      longitud: inicio.longitud + (fin.longitud - inicio.longitud) * t,
    });
  }
  return resultado;
}

function muestrearRuta(puntos: Coordenada[], cantidad: number): Coordenada[] {
  if (puntos.length <= cantidad) return puntos;
  const resultado: Coordenada[] = [];
  for (let i = 0; i < cantidad; i++) {
    const idx = Math.min(puntos.length - 1, Math.round((i / (cantidad - 1)) * (puntos.length - 1)));
    resultado.push(puntos[idx]);
  }
  return resultado;
}

/** Calcula la ruta real por calles (respetando sentidos viales) vía OSRM; cae a interpolación si no está disponible. */
async function obtenerRutaPorCalles(inicio: Coordenada, fin: Coordenada, pasos: number): Promise<Coordenada[]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${inicio.longitud},${inicio.latitud};${fin.longitud},${fin.latitud}?overview=full&geometries=polyline6`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (resp.ok) {
      const cuerpo = (await resp.json()) as { code?: string; routes?: Array<{ geometry?: string }> };
      const geom = cuerpo.routes?.[0]?.geometry;
      if (cuerpo.code === "Ok" && geom) {
        const decodificada = decodificarPolilinea(geom, 6);
        if (decodificada.length >= 2) {
          return muestrearRuta(decodificada, pasos);
        }
      }
    }
  } catch {
    // Fallback offline/CI sin OSRM externo
  }
  return interpolarPuntos(inicio, fin, pasos);
}

async function iniciarSesionReal(page: Page, usuario: string): Promise<string> {
  await page.goto("/#/login");
  const respLoginPromesa = page.waitForResponse(
    (res) => res.url().includes("/auth/login") && res.request().method() === "POST" && res.status() === 200
  );
  await page.getByLabel("Usuario o email").fill(usuario);
  await page.getByTestId("login-contrasena").fill(PASSWORD_DEMO);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  const body = (await (await respLoginPromesa).json()) as { token: string };
  return body.token;
}

/** Envía un ping GPS del teléfono del chofer usando su token RS256 real (sin tocar inputs manuales de lat/lon). */
async function emitirGpsChofer(pageChofer: Page, tokenChofer: string, punto: Coordenada): Promise<void> {
  const ok = await pageChofer.evaluate(
    async ({ coords, token }) => {
      const res = await fetch("/choferes/yo/ubicacion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Demo-Gps": "1",
        },
        body: JSON.stringify({
          latitud: coords.latitud,
          longitud: coords.longitud,
          actualizado_at: new Date().toISOString(),
          precision_metros: 8,
        }),
      });
      return res.ok;
    },
    { coords: punto, token: tokenChofer }
  );
  expect(ok).toBe(true);
}

async function pausaPasoGps(): Promise<void> {
  if (PASO_GPS_MS <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, PASO_GPS_MS));
}

test.describe("E2E Real en la App - Pasajero, Chofer en vivo y Cobro", () => {
  test.skip(
    !EJECUTAR_FLUJO_REAL,
    "Requiere el stack Docker Compose levantado en http://127.0.0.1:8080 (ejecutar con npm.cmd run test:pw:real o npm.cmd run test:pw:demo)."
  );

  test("flujo completo en dos ventanas: chofer por dirección, recorrido exacto calculado y cobro confirmado", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const opcionesContexto = MAXIMIZADO
      ? { viewport: null, deviceScaleFactor: undefined }
      : { viewport: { width: 1280, height: 860 } };
    const contextoChofer = await browser.newContext({
      ...opcionesContexto,
      permissions: ["geolocation"],
      geolocation: { latitude: -27.4538, longitude: -58.9845 },
    });
    const contextoPasajero = await browser.newContext(opcionesContexto);
    const pageChofer = await contextoChofer.newPage();
    const pagePasajero = await contextoPasajero.newPage();

    // Cuando el chofer está en movimiento simulado, evitamos que el ping estático de 2s de VistaChofer
    // pise la posición móvil con la dirección inicial y haga "volver atrás" al pin C.
    let puntoGpsEnMovimiento: Coordenada | null = null;
    await pageChofer.route("**/choferes/yo/ubicacion", async (route) => {
      const headers = route.request().headers();
      if (puntoGpsEnMovimiento && headers["x-demo-gps"] !== "1") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            latitud: puntoGpsEnMovimiento.latitud,
            longitud: puntoGpsEnMovimiento.longitud,
            actualizado_at: new Date().toISOString(),
          }),
        });
        return;
      }
      await route.continue();
    });

    try {
      // 1. Chofer inicia sesión real (RS256): la app detecta su GPS automáticamente, resuelve la dirección y la reporta
      await pageChofer.bringToFront();
      const respUbicacionInicial = pageChofer.waitForResponse(
        (res) => res.url().includes("/choferes/yo/ubicacion") && res.request().method() === "POST" && res.status() === 200
      );
      const tokenChofer = await iniciarSesionReal(pageChofer, "carlos");
      await expect(pageChofer).toHaveURL(/#\/chofer/, { timeout: 10000 });
      await expect(pageChofer.getByTestId("vista-chofer")).toBeVisible();

      const ubicacionInicial = (await (await respUbicacionInicial).json()) as Coordenada;
      puntoGpsEnMovimiento = ubicacionInicial;
      await expect(pageChofer.getByTestId("input-direccion-chofer")).not.toHaveValue("", { timeout: 10000 });
      await expect(pageChofer.getByTestId("ultima-ubicacion-chofer")).not.toContainText("Aún no se reportó", {
        timeout: 10000,
      });

      const btnDisponibilidad = pageChofer.getByTestId("boton-toggle-disponibilidad");
      await expect(btnDisponibilidad).toBeVisible();
      const textoDisponibilidad = await btnDisponibilidad.innerText();
      if (/Iniciar y conectarse/i.test(textoDisponibilidad)) {
        await btnDisponibilidad.click();
      }
      await expect(btnDisponibilidad).toHaveText("Conectado (Desconectarse)", { timeout: 10000 });
      await expect(pageChofer.getByTestId("indicador-ws-chofer")).toContainText(/En línea|Conectado/i, {
        timeout: 10000,
      });
      await pausaVisual(0.7);

      // 2. Pasajero inicia sesión real (RS256), ingresa origen/destino y capturamos la ruta real calculada
      await pagePasajero.bringToFront();
      await iniciarSesionReal(pagePasajero, "ana");
      await expect(pagePasajero).toHaveURL(/#\/pasajero/, { timeout: 10000 });

      const respEstimacionPromesa = pagePasajero.waitForResponse(
        (res) => res.url().includes("/viajes/estimacion") && res.request().method() === "POST" && res.status() === 201
      );
      const inputOrigen = pagePasajero.getByPlaceholder("Ej: Av. Alberdi 250, Resistencia");
      const inputDestino = pagePasajero.getByPlaceholder("Ej.: Shopping Sarmiento, Resistencia");
      await inputOrigen.fill("Plaza 25 de Mayo, Resistencia");
      await inputDestino.fill("Campus UNNE, Resistencia");

      const estimacionReal = (await (await respEstimacionPromesa).json()) as EstimacionReal;
      const rutaCompleta = extraerPuntosRutaCalculada(estimacionReal);
      const puntosRecorrido = muestrearRuta(rutaCompleta, PAUSA_DEMO_MS > 0 ? 18 : 6);

      const btnConfirmar = pagePasajero.getByRole("button", { name: "Confirmar viaje" });
      await expect(btnConfirmar).toBeVisible({ timeout: 15000 });
      await expect(btnConfirmar).toBeEnabled({ timeout: 15000 });
      await pausaVisual(1);
      await btnConfirmar.click();

      await expect(pagePasajero.getByRole("heading", { name: "Viaje confirmado" })).toBeVisible({ timeout: 15000 });
      await pausaVisual(0.8);

      // 3. Chofer recibe la oferta en tiempo real vía WebSocket y la acepta
      await pageChofer.bringToFront();
      const dialogoOferta = pageChofer.getByRole("dialog", { name: "Nueva oferta de viaje" });
      await expect(dialogoOferta).toBeVisible({ timeout: 15000 });
      await pausaVisual(1);
      await dialogoOferta.getByRole("button", { name: /Aceptar/i }).click();

      await expect(pageChofer.getByTestId("estado-viaje-chofer")).toHaveText("Asignado (Ir a buscar pasajero)", {
        timeout: 15000,
      });
      await pausaVisual(0.8);

      // 4. Chofer marca "En camino" y el GPS avanza suavemente desde su dirección inicial hasta el origen A
      const btnEnCamino = pageChofer.getByTestId("boton-chofer-en-camino");
      await expect(btnEnCamino).toBeEnabled({ timeout: 10000 });
      await btnEnCamino.click();
      await expect(pageChofer.getByTestId("estado-viaje-chofer")).toHaveText("Chofer en camino al origen", {
        timeout: 10000,
      });

      await pagePasajero.bringToFront();
      await expect(pagePasajero.getByText(/Chofer en camino/i).first()).toBeVisible({ timeout: 15000 });

      const pinChoferMapa = pagePasajero.locator(".custom-leaflet-pin", { hasText: "C" }).first();
      const puntosAcercamiento = await obtenerRutaPorCalles(
        ubicacionInicial,
        estimacionReal.origen,
        PAUSA_DEMO_MS > 0 ? 12 : 4
      );
      for (const punto of puntosAcercamiento) {
        puntoGpsEnMovimiento = punto;
        await emitirGpsChofer(pageChofer, tokenChofer, punto);
        await expect(pinChoferMapa).toBeVisible({ timeout: 10000 });
        await pausaPasoGps();
      }
      await pausaVisual(1);

      // 5. Chofer inicia el viaje y el GPS sigue suavemente los puntos exactos de la ruta calculada (A -> B)
      await pageChofer.bringToFront();
      const btnIniciar = pageChofer.getByTestId("boton-iniciar-viaje");
      await expect(btnIniciar).toBeEnabled({ timeout: 10000 });
      await btnIniciar.click();
      await expect(pageChofer.getByTestId("estado-viaje-chofer")).toHaveText("Viaje en curso", { timeout: 10000 });

      await pagePasajero.bringToFront();
      await expect(pagePasajero.getByText(/En curso/i).first()).toBeVisible({ timeout: 15000 });

      for (const punto of puntosRecorrido) {
        puntoGpsEnMovimiento = punto;
        await emitirGpsChofer(pageChofer, tokenChofer, punto);
        await expect(pinChoferMapa).toBeVisible({ timeout: 10000 });
        await pausaPasoGps();
      }
      await pausaVisual(1);

      // 6. Chofer finaliza el viaje y cobra al pasajero
      await pageChofer.bringToFront();
      const btnFinalizar = pageChofer.getByTestId("boton-finalizar-viaje");
      await expect(btnFinalizar).toBeEnabled({ timeout: 10000 });
      await btnFinalizar.click();

      await expect(pageChofer.getByTestId("estado-viaje-chofer")).toHaveText("Viaje finalizado", { timeout: 15000 });
      await expect(pageChofer.getByTestId("resumen-cobro-chofer")).toBeVisible({ timeout: 15000 });
      await expect(pageChofer.getByTestId("resumen-cobro-chofer")).toContainText(/confirmado/i);
      await pausaVisual(1);

      // 7. Pasajero recibe la finalización en vivo y ve el recibo con el pago confirmado
      await pagePasajero.bringToFront();
      await expect(pagePasajero.getByRole("heading", { name: "Viaje finalizado" })).toBeVisible({ timeout: 15000 });
      const reciboPasajero = pagePasajero.getByTestId("recibo-cobro-pasajero");
      await expect(reciboPasajero).toBeVisible({ timeout: 15000 });
      await expect(reciboPasajero).toContainText("Pago confirmado");
      await pausaVisual(1.4);
    } finally {
      await contextoPasajero.close();
      await contextoChofer.close();
    }
  });
});
