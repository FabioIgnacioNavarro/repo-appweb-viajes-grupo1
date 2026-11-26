import { test, expect } from "@playwright/test";
import { abrirAccesosDemo, iniciarConPerfilDemo } from "./ayudantes-login";

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
    await page.route("**/reglas/demanda**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          activa: {
            version: 1,
            autor: "sistema",
            creada_en: "2026-01-01T00:00:00Z",
            activa: true,
            tarifa_base_pesos: "1200.00",
            precio_por_kilometro_pesos: "450.00",
            precio_por_minuto_pesos: "120.00",
            multiplicador_minimo: 1,
            multiplicador_maximo: 2.5,
            lluvia_con_precipitacion: 1.2,
            lluvia_sin_precipitacion: 1.0,
            disponibilidad: [{ hasta: null, multiplicador: 1.0 }],
            demanda_por_mil: [{ hasta: null, multiplicador: 1.0 }],
            horario: { MADRUGADA: 1, MANANA: 1, SIESTA: 1, TARDE: 1, NOCHE: 1 },
          },
          historial: [],
        }),
      })
    );
    await page.route("**/ready/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    );

    await page.goto("/#/login");

    // 1. PASAJERO -> #/pasajero + intento de ruta ajena #/admin -> 403 Forbidden
    await iniciarConPerfilDemo(page, /Ana Gómez/i);
    await expect(page).toHaveURL(/#\/pasajero/);
    await expect(page.getByRole("banner")).toContainText("PASAJERO");

    await page.goto("/#/admin");
    await expect(page).toHaveURL(/#\/no_autorizado/);
    await expect(page.getByTestId("vista-no-autorizado")).toContainText(/Acceso No Autorizado \(403 Forbidden\)/i);

    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/#\/login/);

    // 2. CHOFER -> #/chofer
    await iniciarConPerfilDemo(page, /Carlos Maidana/i);
    await expect(page).toHaveURL(/#\/chofer/);
    await expect(page.getByRole("banner")).toContainText("CHOFER");
    await page.getByRole("button", { name: "Salir" }).click();

    // 3. SOPORTE -> #/operador
    await iniciarConPerfilDemo(page, /Lucía Operaciones/i);
    await expect(page).toHaveURL(/#\/operador/);
    await expect(page.getByRole("banner")).toContainText("SOPORTE");
    await page.getByRole("button", { name: "Salir" }).click();

    // 4. ADMINISTRADOR -> #/admin
    await iniciarConPerfilDemo(page, /Martín Administrador/i);
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
    await iniciarConPerfilDemo(page, /Ana Gómez/i);

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
    await abrirAccesosDemo(page);
    await page.getByTestId("input-token-manual").fill(tokenVencido);
    await page.getByTestId("boton-token-manual").click();

    await expect(page).toHaveURL(/#\/login/);
    await expect(page.getByTestId("alerta-login")).toContainText(/expiró/i);
  });

  test("SEG-004: login con usuario y contraseña mediante POST /auth/login redirige según el rol", async ({ page }) => {
    const intentosLogin: Array<{ usuario?: string; contrasena?: string }> = [];
    const usuarios: Record<string, { id: string; rol: string; nombre: string; ruta: RegExp }> = {
      ana: {
        id: "22222222-2222-4222-8222-222222222222",
        rol: "PASAJERO",
        nombre: "Ana Gómez",
        ruta: /#\/pasajero/,
      },
      martin: {
        id: "99999999-9999-4999-8999-999999999999",
        rol: "ADMINISTRADOR",
        nombre: "Martín Administrador",
        ruta: /#\/admin/,
      },
    };

    await page.route("**/auth/login", async (route) => {
      const body = route.request().postDataJSON() as { usuario?: string; contrasena?: string };
      intentosLogin.push(body);
      const cuenta = body.usuario ? usuarios[body.usuario] : undefined;
      if (!cuenta || body.contrasena !== "ViajesDemo2026!") {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            error: { codigo: "CREDENCIALES_INVALIDAS", mensaje: "Usuario o contraseña incorrectos.", detalles: {} },
          }),
        });
      }

      const payload = {
        sub: cuenta.id,
        idUsuario: cuenta.id,
        rol: cuenta.rol,
        name: cuenta.nombre,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.firma-demo`;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token,
          perfil: { id_usuario: cuenta.id, rol: cuenta.rol.toLowerCase(), nombre: cuenta.nombre },
          expira_en_segundos: 3600,
        }),
      });
    });

    await page.route("**/viajes**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ viajes: [], total: 0 }) })
    );
    await page.route("**/reglas/demanda", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ activa: null, historial: [] }) })
    );

    await page.goto("/#/login");

    for (const usuarioLogin of ["ana", "martin"]) {
      const esperado = usuarios[usuarioLogin]!;
      await page.getByTestId("login-usuario").fill(usuarioLogin);
      await page.getByTestId("login-contrasena").fill("ViajesDemo2026!");
      await expect(page.getByTestId("boton-iniciar-sesion")).toBeEnabled();
      await page.getByTestId("boton-iniciar-sesion").click();

      await expect(page).toHaveURL(esperado.ruta);
      await expect(page.getByRole("banner")).toContainText(esperado.rol);
      await page.getByRole("button", { name: "Salir" }).click();
      await expect(page).toHaveURL(/#\/login/);
    }

    expect(intentosLogin).toEqual([
      { usuario: "ana", contrasena: "ViajesDemo2026!" },
      { usuario: "martin", contrasena: "ViajesDemo2026!" },
    ]);
  });

  test("SEG-004: credenciales inválidas muestran error claro y formulario vacío deshabilita envío", async ({ page }) => {
    await page.route("**/auth/login", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { codigo: "CREDENCIALES_INVALIDAS", mensaje: "Usuario o contraseña incorrectos.", detalles: {} },
        }),
      })
    );

    await page.goto("/#/login");
    const botonEnviar = page.getByTestId("boton-iniciar-sesion");
    await expect(botonEnviar).toBeDisabled();

    await page.getByTestId("login-usuario").fill("ana");
    await expect(botonEnviar).toBeDisabled();

    await page.getByTestId("login-contrasena").fill("clave-incorrecta");
    await expect(botonEnviar).toBeEnabled();
    await botonEnviar.click();

    await expect(page).toHaveURL(/#\/login/);
    await expect(page.getByTestId("alerta-login")).toContainText("Usuario o contraseña incorrectos.");
  });

  test("en modo normal oculta accesos demo y credenciales de prueba hasta activar Modo dev", async ({ page }) => {
    await page.goto("/#/login");
    await expect(page.getByRole("heading", { name: /Bienvenido a Che Viaje/i })).toBeVisible();
    await expect(page.getByText(/ViajesDemo2026!/i)).toHaveCount(0);
    await expect(page.getByTestId("panel-demo-dev")).toHaveCount(0);
    await expect(page.locator("header")).not.toContainText(/Grupo 1|Modo Seguro/i);

    await page.getByTestId("boton-modo-dev").click();
    await expect(page.getByTestId("panel-demo-dev")).toBeVisible();
    await expect(page.getByText(/ViajesDemo2026!/i)).toBeVisible();
  });
});
