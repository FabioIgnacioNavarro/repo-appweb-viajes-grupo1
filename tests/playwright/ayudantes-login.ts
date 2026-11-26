import type { Page } from "@playwright/test";

/** Abre las herramientas secundarias (activando Modo dev si estaba apagado) para demo/desarrollo. */
export async function abrirAccesosDemo(page: Page): Promise<void> {
  const panel = page.locator("details").filter({ hasText: "Opciones de acceso para demo y desarrollo" });
  if ((await panel.count()) === 0 || !(await panel.isVisible())) {
    await page.getByTestId("boton-modo-dev").click();
  }
  await panel.waitFor({ state: "visible" });
  const estaAbierto = await panel.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!estaAbierto) {
    await panel.locator("summary").click();
  }
}

/** Mantiene los tests de roles compatibles con el panel secundario colapsable del login. */
export async function iniciarConPerfilDemo(page: Page, nombre: RegExp | string): Promise<void> {
  await abrirAccesosDemo(page);
  await page.getByRole("button", { name: nombre }).click();
}
