# Flujo de trabajo colaborativo

## Antes de implementar

1. Identificar la regla de negocio o requisito que se quiere cubrir.
2. Revisar `AGENTS.md`, `docs/glosario.md`, `docs/modelo.md` y `docs/contratos.md`.
3. Crear o actualizar una entrada del backlog con criterio de aceptación.
4. Registrar un ADR si la tarea implica una decisión técnica relevante.
5. Identificar riesgos de autorización, concurrencia, idempotencia y observabilidad.

## Organización de flujos paralelos

Para avanzar de forma simultánea minimizando el riesgo de colisiones entre agentes y miembros del equipo:

- **Flujo A (Núcleo de Viajes, Persistencia y Concurrencia):**
  - Alcance: `src/ms-viajes/*`, `src/ms-viajes/schema.sql`, persistencia PostgreSQL, transacciones de asignación atómica e idempotencia.
  - Ramas: `feat/viajes-*`, `fix/viajes-*`.
  - Rango de ADRs: **0033 a 0039**.
- **Flujo B (Flota, Tarea Pesada, Búsqueda Geo y Tiempo Real):**
  - Alcance: `src/ms-flota/*`, simulador de carga (500 choferes cada 2s), optimización de cercanía, WebSockets (Tema 20) y `docs/mediciones.md`.
  - Ramas: `feat/flota-*`, `feat/tiempo-real-*`.
  - Rango de ADRs: **0040 a 0049**.
- **Flujo C (Seguridad, Observabilidad, Google Maps y Operación):**
  - Alcance: Firebase Emulator (Tema 19), OpenTelemetry y Jaeger (Tema 18), Google Maps (Routes + Geocoding), Nginx, Compose y `docs/ataque.md`.
  - Ramas: `feat/seguridad-*`, `feat/observabilidad-*`, `feat/maps-*`, `ops/*`.
  - Rango de ADRs: **0050 a 0059**.

## Metodología Git y revisiones

1. **Una rama por cambio o PR:** Cada tarea o funcionalidad avanza en una rama aislada que nace desde `main` actualizado.
2. **Commits frecuentes y explicados:** Cada una o dos iteraciones se realiza un commit con mensaje descriptivo y conventional commits (`feat`, `fix`, `test`, `docs`, `chore`). Cada cambio y decisión debe explicarse didácticamente al usuario.
3. **Paso a paso ordenado:** Una vez notificado el merge de la PR en `main`, recién ahí se sincroniza el repositorio local y se crea la siguiente rama.
4. **Independencia de tests:** El comando `npm test` descubre automáticamente `dist/**/*.test.js`, por lo que no es necesario modificar `package.json` al incorporar nuevos archivos de prueba.

## Durante la implementación

- Mantener el dominio independiente de Express, PostgreSQL y servicios externos.
- Colocar las dependencias detrás de puertos y crear dobles de prueba cuando corresponda.
- Actualizar documentación y tests junto con el cambio, no al final del cuatrimestre.
- No cambiar nombres públicos o estados sin revisar los contratos compartidos.
- No agregar una librería para resolver un problema sin explicar qué garantiza y qué no garantiza.

## Antes de solicitar revisión

- El cambio tiene tests relevantes, incluyendo casos inválidos y de autorización.
- Los tests de dominio no requieren servidor ni base real.
- Se verificaron errores, logs y límites de entrada.
- Se actualizaron API, modelo, glosario o ADR si el cambio los afecta.
- El pull request explica qué cambió, por qué y cómo probarlo.

## Definition of Done

Una tarea está terminada cuando:

- cumple su criterio de aceptación;
- tiene pruebas reproducibles;
- respeta los contratos compartidos;
- documenta decisiones y riesgos;
- no introduce secretos ni dependencias innecesarias;
- fue revisada por otra persona del grupo cuando el flujo Git esté habilitado.

## Convención de commits

Usar mensajes breves y descriptivos, por ejemplo: `docs: define estados iniciales de viaje`, `test: cover concurrent trip acceptance` o `feat: add driver offer expiration`. El mensaje debe explicar el cambio, no solo nombrar el archivo.


## Automatización con Antigravity Skill

Para asistir al equipo y a los agentes de desarrollo en el cumplimiento estricto de este flujo, el repositorio cuenta con una skill configurada en `.agents/skills/flujo-git-github/SKILL.md`.

Esta skill automatiza:
1. **Sincronización con GitHub Issues y Projects:** Creación de tickets con criterios de aceptación y actualización del tablero Kanban (`Backlog` -> `In progress` -> `In review` -> `Done`).
2. **Aislamiento de ramas:** Creación automática de ramas (`feat/<slug>`, `fix/<slug>`) naciendo de `main` actualizado.
3. **Control de Definition of Done:** Verificación de pruebas verdes (`npm.cmd test`) y desacoplamiento de arquitectura hexagonal antes de cada commit.
4. **Commits semánticos explicados:** Registro atómico y didáctico de cada avance.
5. **Apertura de Pull Requests:** Redacción del cuerpo del PR con contexto, comandos de prueba, checklist y vinculación automática de cierre (`Closes #<Issue>`).
