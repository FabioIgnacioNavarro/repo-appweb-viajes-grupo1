import { test, expect } from "@playwright/test";

test.describe("TEST-001 - E2E Playwright: Navegación por Roles, Guardas y Viewports Responsive", () => {
  test.beforeEach(async ({ page }) => {
    // Interceptar generación de tokens en el emulador para cada perfil de prueba
    await page.route("**/auth/token", async (route) => {
      const body = route.request().postDataJSON() as { idUsuario?: string; rol?: string; nombre?: string } | null;
      const rol = body?.rol || "PASAJERO";
      const idUsuario = body?.idUsuario || "usuario-demo-1";
      const payload = {
        sub: idUsuario,
        idUsuario,
        rol,
        name: body?.nombre || "Usuario Demo",
        email: `${idUsuario}@viajes.local`,
        exp: Math.floor(Date.now() / 1000) + 7200,
      };
      const token = `falso.${Buffer.from(JSON.stringify(payload)).toString("base64").replace(/=/g, "")}`;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token }),
      });
    });

    // Mocks de endpoints de backend para chofer y viajes
    await page.route("**/choferes/**", async (route) => {
      if (route.request().url().includes("/ofertas")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ofertas: [] }),
        });
        return;
      }
      if (route.request().url().includes("/disponibilidad")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "chofer-demo-1",
            usuario_id: "chofer-demo-1",
            habilitado: true,
            disponibilidad: true,
            carnet_conducir_validado: true,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chofer: {
            id: "chofer-demo-1",
            usuario_id: "chofer-demo-1",
            habilitado: true,
            disponibilidad: false,
            carnet_conducir_validado: true,
          },
          ubicacion: null,
        }),
      });
    });

    await page.route("**/viajes/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ viajes: [] }),
      });
    });

    await page.route("**/viajes", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ viajes: [] }),
      });
    });
  });

  test("1. Login por rol: PASAJERO, CHOFER, SOPORTE y ADMINISTRADOR ingresan a sus vistas correspondientes", async ({
    page,
  }) => {
    // 1.1 Iniciar en pantalla de Login
    await page.goto("/#/login");
    await expect(page.locator("h1")).toContainText(/Bienvenido a la Plataforma de Viajes/i);

    // 1.2 PASAJERO: Ana Gómez
    await page.click("button:has-text('Ana Gómez')");
    await expect(page).toHaveURL(/#\/pasajero/);
    await expect(page.locator("header")).toContainText("PASAJERO");
    await expect(page.locator("h1")).toContainText(/Hola, Ana Gómez/i);
    await expect(page.locator("text=Variante A: Precio Dinámico")).toBeVisible();

    // Salir
    await page.click("button:has-text('Salir')");
    await expect(page).toHaveURL(/#\/login/);

    // 1.3 CHOFER: Carlos Maidana
    await page.click("button:has-text('Carlos Maidana')");
    await expect(page).toHaveURL(/#\/chofer/);
    await expect(page.locator("header")).toContainText("CHOFER");
    await expect(page.locator("h1")).toContainText(/Hola, Carlos Maidana/i);
    await expect(page.locator("text=Disponibilidad:")).toBeVisible();

    // Salir
    await page.click("button:has-text('Salir')");
    await expect(page).toHaveURL(/#\/login/);

    // 1.4 SOPORTE: Lucía Operaciones
    await page.click("button:has-text('Lucía Operaciones')");
    await expect(page).toHaveURL(/#\/operador/);
    await expect(page.locator("header")).toContainText("SOPORTE");
    await expect(page.locator("h1")).toContainText(/Supervisión de Viajes en Tiempo Real/i);

    // Salir
    await page.click("button:has-text('Salir')");
    await expect(page).toHaveURL(/#\/login/);

    // 1.5 ADMINISTRADOR: Martín Administrador
    await page.click("button:has-text('Martín Administrador')");
    await expect(page).toHaveURL(/#\/admin/);
    await expect(page.locator("header")).toContainText("ADMINISTRADOR");
    await expect(page.locator("h1")).toContainText(/Configuración Global y Reglas de Demanda/i);
    await expect(page.locator("text=Variante A (Regla de Precio Dinámico)")).toBeVisible();
  });

  test("2. Guardas de ruta y RBAC en front-end: redirección de anónimos y usuarios no autorizados", async ({
    page,
  }) => {
    // 2.1 Usuario anónimo intenta entrar directo a paneles protegidos -> Redirige a /login
    await page.goto("/#/pasajero");
    await expect(page).toHaveURL(/#\/login/);

    await page.goto("/#/chofer");
    await expect(page).toHaveURL(/#\/login/);

    await page.goto("/#/operador");
    await expect(page).toHaveURL(/#\/login/);

    await page.goto("/#/admin");
    await expect(page).toHaveURL(/#\/login/);

    // 2.2 Iniciar sesión como PASAJERO
    await page.goto("/#/login");
    await page.click("button:has-text('Ana Gómez')");
    await expect(page).toHaveURL(/#\/pasajero/);

    // Pasajero intenta forzar acceso a /admin o /operador -> Redirige a /no_autorizado (403 Forbidden)
    await page.goto("/#/admin");
    await expect(page).toHaveURL(/#\/no_autorizado/);
    await expect(page.locator("h1")).toContainText(/Acceso No Autorizado \(403 Forbidden\)/i);
    await expect(page.locator("text=Tu rol actual (PASAJERO) no posee permisos")).toBeVisible();

    // Botón para volver al panel natural
    await page.click("button:has-text('Ir a mi panel (PASAJERO)')");
    await expect(page).toHaveURL(/#\/pasajero/);

    // 2.3 Chofer intenta forzar acceso a /admin -> Redirige a /no_autorizado
    await page.click("button:has-text('Salir')");
    await page.click("button:has-text('Carlos Maidana')");
    await expect(page).toHaveURL(/#\/chofer/);

    await page.goto("/#/admin");
    await expect(page).toHaveURL(/#\/no_autorizado/);
    await expect(page.locator("text=Tu rol actual (CHOFER) no posee permisos")).toBeVisible();
  });

  test("3. Navegación global del Administrador: acceso fluido a todos los paneles", async ({ page }) => {
    await page.goto("/#/login");
    await page.click("button:has-text('Martín Administrador')");
    await expect(page).toHaveURL(/#\/admin/);

    // El admin ve la barra de navegación completa en el header
    const navAdmin = page.locator("nav");
    await expect(navAdmin.locator("button:has-text('Pasajero')")).toBeVisible();
    await expect(navAdmin.locator("button:has-text('Chofer')")).toBeVisible();
    await expect(navAdmin.locator("button:has-text('Operador')")).toBeVisible();
    await expect(navAdmin.locator("button:has-text('Admin')")).toBeVisible();

    // Navegar a vista Pasajero
    await navAdmin.locator("button:has-text('Pasajero')").click();
    await expect(page).toHaveURL(/#\/pasajero/);
    await expect(page.locator("text=Variante A: Precio Dinámico")).toBeVisible();

    // Navegar a vista Chofer
    await navAdmin.locator("button:has-text('Chofer')").click();
    await expect(page).toHaveURL(/#\/chofer/);
    await expect(page.locator("text=Disponibilidad:")).toBeVisible();

    // Navegar a vista Operador
    await navAdmin.locator("button:has-text('Operador')").click();
    await expect(page).toHaveURL(/#\/operador/);
    await expect(page.locator("h1")).toContainText(/Supervisión de Viajes en Tiempo Real/i);

    // Regresar a Admin
    await navAdmin.locator("button:has-text('Admin')").click();
    await expect(page).toHaveURL(/#\/admin/);
    await expect(page.locator("h1")).toContainText(/Configuración Global y Reglas de Demanda/i);
  });

  test("4. Viewports responsive: verificación en 360px (móvil), 768px (tablet) y 1024px (desktop)", async ({
    page,
  }) => {
    const viewports = [
      { ancho: 360, alto: 640, nombre: "Móvil (360px)" },
      { ancho: 768, alto: 1024, nombre: "Tablet (768px)" },
      { ancho: 1024, alto: 768, nombre: "Desktop (1024px)" },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.ancho, height: vp.alto });

      // 4.1 Login Responsive
      await page.goto("/#/login");
      await page.waitForLoadState("networkidle");
      const desbordeLogin = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      );
      expect(desbordeLogin, `Desborde horizontal detectado en Login a ${vp.nombre}`).toBe(true);

      // 4.2 Pasajero Responsive
      await page.click("button:has-text('Ana Gómez')");
      await page.waitForLoadState("networkidle");
      const desbordePasajero = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      );
      expect(desbordePasajero, `Desborde horizontal detectado en Pasajero a ${vp.nombre}`).toBe(true);

      // 4.3 Salir y verificar Chofer Responsive
      await page.click("button:has-text('Salir')");
      await page.click("button:has-text('Carlos Maidana')");
      await page.waitForLoadState("networkidle");
      const desbordeChofer = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      );
      expect(desbordeChofer, `Desborde horizontal detectado en Chofer a ${vp.nombre}`).toBe(true);

      // Limpiar sesión para la siguiente iteración
      await page.click("button:has-text('Salir')");
    }
  });

  test("5. Logout y estado WebSocket: destruye sesión y actualiza indicadores de tiempo real", async ({
    page,
  }) => {
    await page.goto("/#/login");
    await page.click("button:has-text('Carlos Maidana')");
    await expect(page).toHaveURL(/#\/chofer/);

    // Header muestra badge CHOFER
    await expect(page.locator("header")).toContainText("CHOFER");

    // Salir
    await page.click("button:has-text('Salir')");
    await expect(page).toHaveURL(/#\/login/);

    // Verificar que en login no queda ninguna sesión activa
    await expect(page.locator("header")).toContainText(/Modo Seguro · Autenticación Externa/i);
    await expect(page.locator("header button:has-text('Salir')")).toHaveCount(0);
  });
});
