---
name: flujo-git-github
description: >-
  Automatiza el ciclo de vida de desarrollo del proyecto según docs/flujo-trabajo.md y AGENTS.md:
  gestión de tareas en docs/backlog.md y tablero Kanban en GitHub Projects (Backlog -> In progress -> In review -> Done),
  sincronización con GitHub Issues con especificación técnica detallada, creación de ramas aisladas (feat/ o fix/),
  verificación de Definition of Done (npm.cmd test y reglas hexagonales), commits semánticos atómicos,
  apertura automática de Pull Requests vinculados a los issues listos para revisión humana y cierre post-merge.
---

# Flujo de Trabajo Git, Kanban, Backlog e Issues

Esta skill estandariza el ciclo de vida completo de cada tarea o funcionalidad en el repositorio, garantizando el cumplimiento estricto de las reglas de [AGENTS.md](../../../AGENTS.md) y [docs/flujo-trabajo.md](../../../docs/flujo-trabajo.md).

Todos los desarrolladores y agentes de IA del equipo deben seguir exactamente este mismo procedimiento para mantener la trazabilidad, el orden del tablero Kanban y la estabilidad del código en `main`.

```mermaid
flowchart TD
    subgraph Fase 0: Definición y Backlog
        A0["Detectar necesidad o bug"] --> A1["Crear entrada en docs/backlog.md ('pendiente')"]
        A1 --> A2["Crear GitHub Issue con plantilla técnica completa"]
        A2 --> A3["Tarjeta entra a 'Backlog' en tablero Kanban"]
    end

    subgraph Fase 1: Inicio de Tarea (In Progress)
        A3 --> B1["Confirmar ID de tarea e Issue"]
        B1 --> B2["Actualizar docs/backlog.md a 'en progreso'"]
        B2 --> B3["Mover tarjeta en Kanban a 'In progress'"]
        B3 --> B4["Sincronizar main (git checkout main && git pull)"]
        B4 --> B5["Crear rama aislada (feat/<slug> o fix/<slug>)"]
    end

    subgraph Fase 2: Implementación y Commits
        B5 --> C1["Desarrollar respetando arquitectura hexagonal"]
        C1 --> C2["Verificar tests: npm.cmd test"]
        C2 --> C3["Commits semánticos atómicos (feat:, fix:, test:, docs:)"]
    end

    subgraph Fase 3: Revisión y Pull Request (In Review)
        C3 --> D1["Verificar Definition of Done"]
        D1 --> D2["Actualizar docs/backlog.md a 'en revisión'"]
        D2 --> D3["git push -u origin <rama>"]
        D3 --> D4["Crear Pull Request con 'Closes #Issue'"]
        D4 --> D5["Mover tarjeta en Kanban a 'In review'"]
        D5 --> D6["Revisión de pares y aprobación de merge"]
    end

    subgraph Fase 4: Post-Merge y Cierre (Done)
        D6 --> E1["Pull Request mergeado a main en GitHub"]
        E1 --> E2["Sincronizar local: git checkout main && git pull"]
        E2 --> E3["Eliminar rama local: git branch -d <rama>"]
        E3 --> E4["Actualizar docs/backlog.md a 'terminado'"]
        E4 --> E5["Commit y push a main: docs: marcar <ID> terminado"]
        E5 --> E6["Issue se cierra automáticamente y tarjeta pasa a 'Done'"]
    end
```

---

## 📋 Mapeo de Estados: La Regla Tripartita de Sincronización

Para que el estado del proyecto sea transparente y predecible, **el archivo local, el Issue/PR y el Tablero Kanban deben reflejar exactamente el mismo estado en cada momento**:

| Estado Kanban (Tablero) | Estado en `docs/backlog.md` | Estado Git / GitHub Issue / PR | Acción que dispara la transición |
|---|---|---|---|
| **Backlog** (o *Todo*) | `pendiente` | GitHub Issue Abierto (sin rama activa ni asignación activa) | Registro inicial de la tarea o requerimiento. |
| **In progress** | `en progreso` | Issue asignado, rama `feat/<slug>` o `fix/<slug>` creada | Inicio activo del desarrollo por un agente o desarrollador. |
| **In review** | `en revisión` | Rama pusheada, Pull Request abierto vinculando `Closes #<Issue>` | Desarrollo finalizado, tests pasando al 100%, esperando revisión de pares. |
| **Done** | `terminado` | Pull Request mergeado en `main`, Issue cerrado por GitHub | Merge aprobado, `main` actualizado, rama eliminada y backlog sincronizado. |

---

## 🗂️ Gestión del Tablero Kanban en GitHub Projects

El proyecto cuenta con un tablero Kanban en GitHub Projects. Los agentes y miembros del equipo gestionan las tarjetas mediante tres vías complementarias:

### 1. Automatizaciones Nativas de GitHub Projects (Recomendado y por defecto)
GitHub Projects (v2) permite automatizaciones integradas en `Settings -> Workflows` del proyecto:
- **Auto-add to project:** Todo issue creado en el repositorio entra automáticamente a la columna **Backlog**.
- **Pull request opened:** Al abrir un PR vinculado al issue, la tarjeta pasa automáticamente a **In review**.
- **Item closed / PR merged:** Al mergear el PR a `main` y cerrarse el issue con `Closes #<Issue>`, la tarjeta se mueve automáticamente a **Done**.

### 2. Actualización por CLI (`gh project`)
Si un agente o desarrollador desea inspeccionar o mover tarjetas directamente desde la terminal:

> [!NOTE]
> Para usar comandos de `gh project`, el token de GitHub CLI debe contar con el permiso `project`. Si la consola devuelve `error: token is missing required scopes [read:project]`, ejecutar una única vez:
> ```powershell
> gh auth refresh -s project
> ```

Comandos útiles de gestión de tarjetas:
```powershell
# 1. Listar proyectos del repositorio o usuario
gh project list --owner FabioIgnacioNavarro

# 2. Listar campos y opciones (para obtener el Field ID de 'Status' y los Option IDs de las columnas)
gh project field-list <numero-proyecto> --owner FabioIgnacioNavarro

# 3. Listar tarjetas activas del proyecto
gh project item-list <numero-proyecto> --owner FabioIgnacioNavarro

# 4. Mover una tarjeta de columna (ej. mover a 'In progress' o 'In review')
gh project item-edit --id <item-id> --field-id <status-field-id> --project-id <project-id> --single-select-option-id <option-id>
```

### 3. Fallback Manual (UI Web de GitHub)
Si el CLI no cuenta con el scope extendido de proyectos o no se desean correr scripts, el agente:
1. Proporciona en el chat el enlace directo al tablero Kanban: `https://github.com/users/FabioIgnacioNavarro/projects/<numero-proyecto>` (o al nivel de la organización).
2. Solicita o confirma al usuario arrastrar la tarjeta a la columna correspondiente (**In progress**, **In review** o **Done**).

---

## 📝 Estándar de Redacción de Issues en GitHub

Todo Issue creado o actualizado en GitHub **debe seguir un formato de especificación técnica completa** (nunca una sola línea resumida), para que cualquier integrante del equipo o agente entienda el problema, los archivos afectados y cómo verificarlo sin ambigüedades:

```markdown
## 📌 Contexto y Problema
<Explicación clara del requerimiento de negocio o técnico, por qué es necesario y qué problema resuelve dentro de la plataforma de viajes.>

## 🏗️ Alcance Técnico
- **Servicios / Módulos involucrados:** <ej. `ms-viajes`, `ms-tarifas`, `ms-flota`, `src/compartido/`>
- **Archivos clave:** <rutas a archivos de dominio, puertos, adaptadores o esquemas SQL>
- **Documentación / ADRs relacionados:** <ej. `docs/modelo.md`, `docs/contratos.md`, `docs/adr/XXXX-...`>
- **Prioridad:** <Alta | Media | Baja> | **Flujo:** <Flujo A | Flujo B | Flujo C | Común>

## ✅ Criterios de Aceptación
- [ ] <Criterio verificable 1>
- [ ] <Criterio verificable 2>
- [ ] <Criterio verificable 3>

## 🧪 Plan de Verificación y Pruebas
- [ ] <Prueba unitaria / integración / concurrencia específica a cubrir>
- [ ] Suite completa pasando con `npm.cmd test`.

## ⚠️ Invariantes y Reglas a Respetar
- <Invariantes de negocio o arquitectura hexagonal aplicables según AGENTS.md>
```

---

## 🚀 Fase 0: Creación de Tareas y Registro en Backlog

Si se requiere registrar una nueva tarea, bug o mejora sin comenzar a programar de inmediato:

1. **Investigar contexto:** Revisar qué módulos, contratos compartidos (`docs/contratos.md`) o ADRs se ven afectados.
2. **Registrar en `docs/backlog.md`:** Agregar la fila en la tabla con ID representativo en estado `pendiente`.
3. **Crear el Issue en GitHub con la Plantilla Técnica:**
   ```powershell
   gh issue create --title "[<ID>] <Título descriptivo>" --body-file <archivo_temporal_cuerpo.md>
   ```
4. **Verificar en el Tablero Kanban:** Confirmar que la tarjeta aparezca en la columna **Backlog** (vía workflow nativo o agregándola al proyecto).
5. **Confirmar al usuario:** Informar el número de Issue creado y su enlace.

---

## 🛠️ Fase 1: Iniciar Tarea (Mover a In Progress)

Cuando se inicia el trabajo en una tarea (ejemplo: `DOM-005`):

### 1. Localizar la tarea en `docs/backlog.md`
- Identificar ID, título, prioridad y criterios de aceptación.

### 2. Sincronizar o crear el GitHub Issue
- Verificar existencia del Issue:
  ```powershell
  gh issue list --search "<ID_TAREA>" --state open
  ```
- Si no existe, crearlo con el estándar técnico. Si existe, enriquecerlo con `gh issue edit <N> --body-file ...`.
- Anotar el número de issue asignado (ejemplo: `#14`).

### 3. Actualizar `docs/backlog.md`
- Cambiar el estado de la tarea de `pendiente` a `en progreso`.

### 4. Mover la tarjeta en el Tablero Kanban a `In progress`
- Si se usa CLI: actualizar el estado con `gh project item-edit`.
- Si se usa interfaz web: arrastrar la tarjeta de **Backlog** a **In progress**.

### 5. Crear la rama correspondiente desde `main` limpio
- Asegurarse de estar en `main` actualizado:
  ```powershell
  git checkout main
  git pull origin main
  ```
- Crear la rama con nombre semántico: `feat/<slug>` o `fix/<slug>`:
  ```powershell
  git checkout -b feat/carrera-confirmacion-recalculo
  ```

---

## 💻 Fase 2: Implementación y Commits

Durante el desarrollo:

### 1. Respetar reglas arquitectónicas (AGENTS.md)
- **Aislamiento de Dominio:** Ningún archivo en `src/**/dominio.ts` debe importar `express`, `pg`, bases de datos ni dependencias de infraestructura externa.
- **Puertos y Adaptadores:** Toda integración externa entra por un puerto y cuenta con doble de prueba (en memoria / falso).
- **Configuración:** Toda variable de entorno debe validarse al inicio.
- **Idempotencia y Concurrencia:** Diseñar operaciones críticas para resistir llamadas simultáneas.

### 2. Validar pruebas antes de cada commit
- Ejecutar la suite:
  ```powershell
  npm.cmd test
  ```
  *(En PowerShell de Windows usar siempre `npm.cmd` para evitar bloqueos de ejecución de scripts).*
- Si alguna prueba falla, corregir antes de registrar el commit.

### 3. Commits semánticos y atómicos
- Agregar únicamente los archivos específicos de la tarea (`git add <archivos>`), evitando `git add .` indiscriminado.
- Usar Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Explicar el qué y el por qué en el cuerpo del commit:
  ```powershell
  git commit -m "feat(viajes): asegurar verificacion atomica en confirmacion

  - Bloquea el snapshot de precio al momento de confirmar
  - Agrega test concurrente en viaje.test.ts
  - Ref: DOM-005"
  ```

---

## 🔍 Fase 3: Cierre de Desarrollo y Pull Request (Mover a In Review)

Al completar la funcionalidad:

### 1. Validar Definition of Done
Verificar que:
- El criterio de aceptación del backlog esté completamente cumplido.
- `npm.cmd test` pasa al 100% (cero fallos).
- Se actualizaron contratos (`docs/contratos.md`), modelo o ADR si la decisión lo requería.

### 2. Actualizar `docs/backlog.md`
- Cambiar el estado de la tarea de `en progreso` a `en revisión`.
- Registrar un commit atómico con el cambio:
  ```powershell
  git add docs/backlog.md
  git commit -m "docs: marcar <ID> en revision en backlog"
  ```

### 3. Subir la rama a GitHub
```powershell
git push -u origin <nombre-de-rama>
```

### 4. Crear el Pull Request vinculado al Issue
#### Opción A: Vía GitHub CLI (`gh pr create`)
```powershell
$prBody = @"
## 🎯 Tarea y Contexto
- **Backlog ID:** <ID>
Closes #<NumeroIssue>
- **Criterio de aceptación:** <Criterio de docs/backlog.md>
- **ADR asociado:** <ADR si corresponde, ej. ADR 0033>

## 🛠️ Cambios introducidos
- <Resumen claro de archivos y lógica cambiada>

## 🧪 Cómo probar este PR
```powershell
npm.cmd test
```

## ✅ Checklist de Definition of Done
- [x] Arquitectura hexagonal respetada (dominio desacoplado).
- [x] Tests unitarios y de integración pasando al 100%.
- [x] Contratos y documentación sincronizados.
- [x] docs/backlog.md actualizado a 'en revisión'.
"@

gh pr create --title "<tipo>(<alcance>): <ID> <resumen>" --body $prBody
```

#### Opción B: Fallback sin CLI
Si `gh` no está disponible, proporcionar al usuario en el chat:
1. El título exacto del PR.
2. La descripción completa en Markdown con `Closes #<Issue>`.
3. El enlace directo para abrir el formulario en GitHub:
   `https://github.com/FabioIgnacioNavarro/repo-appweb-viajes-grupo1/compare/<nombre-de-rama>?expand=1`

### 5. Mover la tarjeta en el Tablero Kanban a `In review`
- Con automatización activa: al abrir el PR con `Closes #<Issue>`, GitHub lo mueve a **In review**.
- Sin automatización: mover manualmente la tarjeta a **In review** (vía CLI o interfaz web).

### 6. Ceder el paso a la revisión de pares
Informar en el chat el enlace del PR publicado, quedando a la espera de la **revisión humana y aprobación de merge**.

---

## 🏁 Fase 4: Post-Merge y Cierre Definitivo de Ciclo Kanban (Mover a Done)

Una vez que el Pull Request es revisado, aprobado y mergeado a `main` en GitHub:

### 1. Sincronizar `main` local
```powershell
git checkout main
git pull origin main
```

### 2. Limpiar la rama de feature local y remota
```powershell
# Eliminar la rama local ya integrada
git branch -d <nombre-de-rama>

# Podar referencias remotas
git fetch -p
```

### 3. Actualizar `docs/backlog.md` a `terminado`
Editar `docs/backlog.md` y cambiar el estado de la tarea de `en revisión` a `terminado`.

### 4. Commitear y subir la actualización a `main`
```powershell
git add docs/backlog.md
git commit -m "docs: marcar <ID> terminado en backlog"
git push origin main
```

### 5. Verificar cierre del Issue y estado `Done` en el Tablero Kanban
- El Issue vinculado en el PR se cierra automáticamente gracias a la palabra clave `Closes #<Issue>`.
- **Verificación obligatoria del Issue:** Ejecutar `gh issue view <NumeroIssue> --json state`. Si por particularidades de formato o de la estrategia de merge de GitHub el Issue sigue figurando como `OPEN`, cerrarlo inmediatamente con:
  ```powershell
  gh issue close <NumeroIssue> --comment "Cerrado tras el merge de PR #<NumeroPR>."
  ```
- Confirmar que la tarjeta en el Tablero Kanban figure en **Done** (o moverla si no hay automatización).
- El ciclo de la tarea queda formalmente concluido y el equipo puede iniciar la siguiente tarea desde Fase 1.
