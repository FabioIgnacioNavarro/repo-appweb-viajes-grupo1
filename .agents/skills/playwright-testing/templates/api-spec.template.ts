import { test, expect } from "@playwright/test";

// Tokens falsos estándar del repositorio (ver src/compartido/jwt-falso.ts)
const TOKEN_PASAJERO = "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyIiwicm9sIjoiUEFTQUpFUk8ifQ";
const TOKEN_CHOFER = "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwicm9sIjoiQ0hPRkVSIn0";

test.describe("API E2E - Microservicios de Viajes", () => {
  test("debe rechazar solicitudes sin autenticación", async ({ request }) => {
    const respuesta = await request.get("/viajes");
    expect(respuesta.status()).toBe(401);
  });

  test("debe permitir estimar un recorrido para la demo web", async ({ request }) => {
    const respuesta = await request.post("/demostracion/estimaciones", {
      data: {
        origen: { latitud: -27.451, longitud: -58.986 },
        destino: { latitud: -27.462, longitud: -58.993 }
      }
    });

    expect(respuesta.status()).toBe(201);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toHaveProperty("precio_estimado");
    expect(cuerpo).toHaveProperty("distancia_metros");
    expect(cuerpo).toHaveProperty("vigente_hasta");
  });
});
