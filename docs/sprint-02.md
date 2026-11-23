# Sprint 2: login real, modo oscuro/desarrollador, CI, k6 y Grafana Cloud

- **Objetivo:** completar el login con usuario y contraseña, sumar Modo Oscuro, control `"Centrar mapa"` y Modo Desarrollador en el front, automatizar CI (unit + Playwright E2E), incorporar pruebas de stress con `k6` (en reemplazo de los ataques cruzados) y conectar la observabilidad hacia **Grafana Cloud**.
- **Regla de compatibilidad:** toda tarea que agregue o modifique endpoints o variables de entorno actualiza primero `docs/api.md`, `docs/contratos.md` o `.env.example`.

## Responsables y bloques cohesivos (1 bloque = 1 dueño)

| Persona | GitHub | Flujo | Bloque asignado | Tareas |
|---|---|---|---|---|
| **Fabio** | `@FabioIgnacioNavarro` | Flujo B | **Calidad Automatizada, CI y Stress** (Playwright E2E, GitHub Actions, k6 Stress) | `TEST-002`, `OPS-005`, `MED-003` |
| **Joel** | `@maxechev` | Flujo C | **Seguridad, Login y Observabilidad** (Usuario/contraseña RS256, CSP, Grafana Cloud) | `SEG-004`, `SEG-005`, `OBS-002` |
| **Valentino (Valen)** | `@ValentinoEBorchichi` | Flujo A | **Producto Web, Simulación de Tarifa y Cierre/Correcciones** (Modo Dev, Modo Oscuro, Centrar mapa y correcciones finales) | `DEV-001`, `WEB-010`, `WEB-011`, `DOC-002` |

## Tareas del Sprint 2

| ID | Tarea | Responsable | Flujo | Issue |
|---|---|---|---|---|
| `DEV-001` | Modo desarrollador: simulación de hora, modificadores en vivo y recomendaciones | Valen | Flujo A | #79 |
| `WEB-010` | Modo oscuro completo en UI y mapa Leaflet | Valen | Flujo A | #80 |
| `WEB-011` | Control explícito "Centrar mapa" y mejoras de UX en recorrido | Valen | Flujo A | #81 |
| `SEG-004` | Login apropiado con usuario y contraseña sobre emulador OIDC/JWKS | Joel | Flujo C | #82 |
| `SEG-005` | Auditoría y endurecimiento de CSP en Nginx para nuevas funcionalidades | Joel | Flujo C | #83 |
| `OBS-002` | Observabilidad distribuida en Grafana Cloud (trazas, métricas y logs) | Joel | Flujo C | #84 |
| `TEST-002` | Ampliación de tests E2E Playwright (flujo pasajero nuevo, login, modo oscuro y modo dev) | Fabio | Flujo B | #85 |
| `OPS-005` | Pipeline CI en GitHub Actions (build, unit/integración y E2E Playwright) | Fabio | Flujo B | #86 |
| `MED-003` | Suite de pruebas de stress con k6 y actualización de mediciones | Fabio | Flujo B | #87 |
| `DOC-002` | Cierre Sprint 2: correcciones finales, clon limpio Docker e informe/guión | Los tres (lidera Valen) | Común | #88 |

## Reparto de los 3 Temas de Presentación Grupal

1. **Fabio:** **Tema 20** (Tiempo Real WebSockets) + Testing E2E con Playwright, Pipeline CI y Pruebas de Stress con `k6`.
2. **Joel:** **Tema 19** (Seguridad OAuth2/OIDC, login RS256, RBAC y CSP) + **Tema 18** (Observabilidad distribuida en Grafana Cloud).
3. **Valen:** Framework Frontend (`React + TypeScript + Vite + Tailwind`), mapa Leaflet + Variante A interactiva con Modo Desarrollador, Arquitectura Hexagonal y Concurrencia/Pagos.

## Fronteras de archivos para evitar colisiones

| Zona | Dueño |
|---|---|
| `.github/workflows/`, `tests/playwright/`, `carga/k6/`, `docs/mediciones.md` | Fabio |
| `src/emulador-auth/`, `web/src/vistas/login/`, `nginx.conf`, `src/compartido/observabilidad.ts`, `docker-compose.yml`, `.env.example` | Joel |
| `src/ms-tarifas/dominio.ts`, `src/ms-tarifas/http.ts`, `web/src/componentes/dev/`, `web/src/vistas/pasajero/`, `web/src/componentes/mapa/`, `web/src/nucleo/estilos/` | Valen |

## Definition of Done del Sprint 2

- `.github/workflows/ci.yml` en verde (typecheck + `npm test` con PostgreSQL + `playwright test`).
- Login con usuario/contraseña RS256, Modo Oscuro, `"Centrar mapa"` y Modo Desarrollador funcionando sin errores de CSP en `http://localhost:8080`.
- Trazas, métricas y logs visibles en vivo en **Grafana Cloud**.
- Corridas reproducibles de stress con `k6` documentadas en `docs/mediciones.md`.
- Correcciones finales integradas, clon limpio verificado con `docker compose down -v && docker compose up -d --build` y guión grupal listo en `docs/guion-demo.md`.
