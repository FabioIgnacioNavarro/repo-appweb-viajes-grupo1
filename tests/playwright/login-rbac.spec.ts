import { test, expect } from "@playwright/test";

test.describe("WEB-002 - Login por rol con emulador de identidad, 401 y RBAC 403", () => {
  test("login por cada rol usando /auth/token, redirección, acceso denegado 403 y logout", async ({ page }) => {
    const solicitudesAuth: Array<{ id_usuario?: string; rol?: string }> = [];

    await page.route("**/auth/token", async (route) => {
      const body = route.request().postDataJSON() as {
        id_usuario?: string;
        idUsuario?: string;
        rol?: string;
        nombre?: string;
      };
      const id = body.id_usuario ?? body.idUsuario ?? "usuario-desconocido";
      const rol = (body.rol ?? "pasajero").toUpperCase();
      solicitudesAuth.push({ id_usuario: body.id_usuario, rol: body.rol });

      const payload = {
        sub: id,
        idUsuario: id,
        rol,
        name: body.nombre ?? rol,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firma-demo`;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token, id_usuario: id, rol: rol.toLowerCase() }),
      });
    });

    await page.route("**/viajes**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ viajes: [] }) })
    );
    await page.route("**/choferes/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ofertas: [] }) })
    );

    await page.goto("/#/login");

    // 1. PASAJERO -> #/pasajero + intento de ruta ajena #/admin -> 403 Forbidden
    await page.getByRole("button", { name: /Ana Gómez/i }).click();
    await expect(page).toHaveURL(/#\/pasajero/);
    await expect(page.getByRole("banner")).toContainText("PASAJERO");

    await page.goto("/#/admin");
    await expect(page).toHaveURL(/#\/no_autorizado/);
    await expect(page.getByTestId("vista-no-autorizado")).toContainText(/Acceso No Autorizado \(403 Forbidden\)/i);

    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/#\/login/);

    // 2. CHOFER -> #/chofer
    await page.getByRole("button", { name: /Carlos Maidana/i }).click();
    await expect(page).toHaveURL(/#\/chofer/);
    await expect(page.getByRole("banner")).toContainText("CHOFER");
    await page.getByRole("button", { name: "Salir" }).click();

    // 3. SOPORTE -> #/operador
    await page.getByRole("button", { name: /Lucía Operaciones/i }).click();
    await expect(page).toHaveURL(/#\/operador/);
    await expect(page.getByRole("banner")).toContainText("SOPORTE");
    await page.getByRole("button", { name: "Salir" }).click();

    // 4. ADMINISTRADOR -> #/admin
    await page.getByRole("button", { name: /Martín Administrador/i }).click();
    await expect(page).toHaveURL(/#\/admin/);
    await expect(page.getByRole("banner")).toContainText("ADMINISTRADOR");
    await page.getByRole("button", { name: "Salir" }).click();

    expect(solicitudesAuth).toEqual([
      { id_usuario: "22222222-2222-4222-8222-222222222222", rol: "pasajero" },
      { id_usuario: "11111111-1111-4111-8111-111111111111", rol: "chofer" },
      { id_usuario: "44444444-4444-4444-8444-444444444444", rol: "soporte" },
      { id_usuario: "99999999-9999-4999-8999-999999999999", rol: "administrador" },
    ]);
  });

  test("respuesta 401 del backend cierra la sesión, vuelve al login y muestra mensaje claro", async ({ page }) => {
    await page.route("**/auth/token", (route) => {
      const payload = {
        sub: "22222222-2222-4222-8222-222222222222",
        idUsuario: "22222222-2222-4222-8222-222222222222",
        rol: "PASAJERO",
        name: "Ana Gómez",
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firma`;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token }),
      });
    });

    await page.route("**/viajes**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { codigo: "TOKEN_INVALIDO", mensaje: "El token expiró en el servidor.", detalles: {} },
        }),
      })
    );

    await page.goto("/#/login");
    await page.getByRole("button", { name: /Ana Gómez/i }).click();

    await expect(page).toHaveURL(/#\/login/);
    await expect(page.getByTestId("alerta-login")).toBeVisible();
    await expect(page.getByTestId("alerta-login")).toContainText(/TOKEN_INVALIDO/);
  });

  test("token manual expirado es rechazado en el formulario con mensaje claro", async ({ page }) => {
    const payloadVencido = {
      sub: "22222222-2222-4222-8222-222222222222",
      idUsuario: "22222222-2222-4222-8222-222222222222",
      rol: "PASAJERO",
      exp: Math.floor(Date.now() / 1000) - 600,
    };
    const tokenVencido = `falso.${Buffer.from(JSON.stringify(payloadVencido)).toString("base64url")}`;

    await page.goto("/#/login");
    await page.getByTestId("input-token-manual").fill(tokenVencido);
    await page.getByTestId("boton-token-manual").click();

    await expect(page).toHaveURL(/#\/login/);
    await expect(page.getByTestId("alerta-login")).toContainText(/expiró/i);
  });
});
