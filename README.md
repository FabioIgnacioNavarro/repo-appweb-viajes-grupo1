# Plataforma Backend de Viajes — Programación IV (Grupo 1)

Plataforma backend de viajes en tiempo real construida bajo **Arquitectura Hexagonal**, microservicios en **Node.js 22 LTS / TypeScript**, base de datos relacional **PostgreSQL**, observabilidad distribuida con **OpenTelemetry y Jaeger**, y autenticación externa basada en **OIDC/JWKS y RBAC**.

Incluye la **Variante Obligatoria A (Precio dinámico por demanda auditado)** y los temas de cátedra documentados en [`docs/temas-catedra.md`](docs/temas-catedra.md):
- **Tema 4 (Base arquitectónica):** Monolito modular y microservicios (`ms-viajes`, `ms-tarifas` y `ms-flota`) con fronteras hexagonales, contratos HTTP explícitos, aislamiento de fallos (`503`) y guía de demo en [`docs/demo-microservicios.md`](docs/demo-microservicios.md).
- **Tema 18:** Observabilidad distribuida con OpenTelemetry, SDK OTLP, propagación de contexto W3C `traceparent` y servidor Jaeger / Grafana Cloud.
- **Tema 19:** Emulador de Identidad JWKS, emisión asimétrica RS256, roles RBAC y control de acceso por recurso.
- **Tema 20:** Comunicación en tiempo real mediante WebSockets autenticados, autorización por viaje y recuperación del estado por HTTP.

---

## 🚀 Secuencia de Clon Limpio (Paso a Paso)

Para levantar el proyecto con la configuración local de desarrollo. El archivo `.env.example` contiene valores locales de ejemplo, no una clave de Google Maps. Copialo a `.env` si querés mantener explícita la configuración; el archivo `.env` resultante es local y no se versiona. Compose también define valores predeterminados para las variables opcionales.

### 1. Clonar e instalar dependencias
```powershell
git clone https://github.com/FabioIgnacioNavarro/repo-appweb-viajes-grupo1.git
cd repo-appweb-viajes-grupo1
Copy-Item .env.example .env
```

### 2. Instalar dependencias, preparar entorno y verificar calidad
```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd run lint
npm.cmd run build
```

> **Comandos reproducibles de preparación y calidad (`package.json`):**
> - `npm.cmd run setup`: copia `.env.example` a `.env` si falta y, cuando `DATABASE_URL` está definida, aplica de forma idempotente `src/ms-flota/schema.sql`, `src/ms-tarifas/schema.sql` y `src/ms-viajes/schema.sql`.
> - `npm.cmd run seed`: carga y verifica de forma idempotente los datos sintéticos iniciales (chofer `carlos`, vehículo `AA123BB`, zona `resistencia` y regla tarifaria v1) cuando `DATABASE_URL` está definida.
> - `npm.cmd run lint`: ejecuta ESLint, verificación de fronteras hexagonales (`scripts/verificar-arquitectura.mjs`) y chequeo de tipos TypeScript (`server`, `tests` y `web`).
> - Al levantar Docker Compose por primera vez, PostgreSQL monta los mismos scripts en `/docker-entrypoint-initdb.d`, por lo que esquemas y semilla quedan cargados automáticamente.

### 3. Validar y levantar la plataforma completa en Docker Compose
```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

Compose inicializa automáticamente los esquemas de los tres servicios y carga el chofer de prueba (`carlos`) con su vehículo asignado (`AA123BB`), además de las zonas y reglas de tarifa. Esperá a que `postgres`, el emulador de identidad, los tres microservicios y el gateway figuren saludables. Luego comprobá el acceso público:

```powershell
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod http://localhost:8080/ready/viajes
Invoke-RestMethod http://localhost:8080/ready/tarifas
Invoke-RestMethod http://localhost:8080/ready/flota
```

### Roles y cuentas de prueba (Emulador OIDC / JWKS)

El emulador local (`auth-emulator`) ofrece cuentas ficticias reproducibles para login (`POST /auth/login`), emisión directa (`POST /auth/token`) y registro local de pasajeros o choferes (`POST /auth/registro`). Contraseña predeterminada: `ViajesDemo2026!` (configurable con `AUTH_DEMO_PASSWORD`). Deshabilitado en `NODE_ENV=production`.

| Usuario | Email | Rol | UUID (`sub` / `id_usuario`) | Uso principal en pruebas y demo |
|---|---|---|---|---|
| `ana` | `ana@viajes.local` | `PASAJERO` | `22222222-2222-4222-8222-222222222222` | Cotizar, confirmar, seguir el viaje en tiempo real y consultar recibo. |
| `carlos` | `carlos@viajes.local` | `CHOFER` | `11111111-1111-4111-8111-111111111111` | Habilitado y con vehículo `AA123BB`; activa disponibilidad, envía GPS, acepta ofertas y finaliza viajes. |
| `lucia` | `lucia@viajes.local` | `SOPORTE` | `44444444-4444-4444-8444-444444444444` | Listado global paginado/filtrado de viajes, auditoría inmutable de tarifas y cancelación operativa. |
| `martin` | `martin@viajes.local` | `ADMINISTRADOR` | `99999999-9999-4999-8999-999999999999` | Reglas dinámicas versionadas (`ms-tarifas`), alta/habilitación de choferes y asignación de vehículos (`ms-flota`). |

### 4. Ejecutar pruebas y flujo E2E
```powershell
npm.cmd test
$env:E2E_BASE_URL = "http://localhost:8080"
npm.cmd run test:e2e
```

La suite completa incluye pruebas unitarias y de integración. Las pruebas que requieren PostgreSQL o el gateway se ejecutan cuando sus dependencias están disponibles.

### 5. Ejecutar la demo reproducible por HTTP

En VS Code, abrí `requests/flujo-e2e.http` con la extensión REST Client y ejecutá sus solicitudes en orden. El archivo indica cuándo copiar los identificadores que devuelve cada paso. Para la guía con tiempos, roles, precio dinámico, WebSocket, cobro, falla y seguridad, seguí [`docs/guion-demo.md`](docs/guion-demo.md).

### Interfaz web unificada y desarrollo

Al levantar Docker Compose (`docker compose up --build -d`), Nginx compila y sirve automáticamente la interfaz web estática desde `http://localhost:8080/` bajo el mismo origen que la API (sin CORS), con fallback SPA a `index.html` y canal WebSocket habilitado en `/tiempo-real` y `/ws`.

Para desarrollo local con recarga instantánea de Vite (opcional), podés ejecutar en una segunda terminal:

```powershell
npm.cmd run dev:web
```

Abrí `http://localhost:5173`; Vite reenvía las llamadas de API y WebSocket al gateway local. Para entrar con identidades compatibles con los datos sintéticos sembrados por Compose, usá la opción de token manual y los actores documentados en `requests/flujo-e2e.http`.

El Compose monta los esquemas de Flota, Tarifas y Viajes en `/docker-entrypoint-initdb.d`; PostgreSQL los ejecuta al crear un volumen vacío. Un volumen existente no vuelve a ejecutar scripts nuevos. En ese caso, actualizar el esquema existente antes de repetir la demo. En particular, versiones antiguas de `viajes.cobro` pueden conservar una restricción que solo permite `CONFIRMADO`, aunque el flujo necesita guardar primero un cobro `PENDIENTE`. La migración siguiente es segura de repetir y conserva los registros:

```powershell
@'
BEGIN;
ALTER TABLE viajes.cobro ADD COLUMN IF NOT EXISTS intentos INTEGER NOT NULL DEFAULT 1;
ALTER TABLE viajes.cobro DROP CONSTRAINT IF EXISTS cobro_estado_check;
ALTER TABLE viajes.cobro DROP CONSTRAINT IF EXISTS ck_cobro_estado;
ALTER TABLE viajes.cobro ADD CONSTRAINT ck_cobro_estado CHECK (estado IN ('PENDIENTE', 'FALLIDO', 'CONFIRMADO'));
ALTER TABLE viajes.cobro DROP CONSTRAINT IF EXISTS cobro_intentos_check;
ALTER TABLE viajes.cobro DROP CONSTRAINT IF EXISTS ck_cobro_intentos;
ALTER TABLE viajes.cobro ADD CONSTRAINT ck_cobro_intentos CHECK (intentos >= 0);
COMMIT;
'@ | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U viajes -d viajes
```

Si un viaje ya quedó finalizado pero no recibió cobro, después de actualizar el servicio y aplicar esta migración se puede usar **“Ver o completar recibo”** en el historial del chofer. La operación conserva el precio final y reutiliza el único cobro del viaje.

La conexión desde el host usa el puerto `5434`; entre contenedores PostgreSQL escucha en `5432`.

## Simulador local de carga de Flota (MED-001)

El simulador no se inicia junto con la aplicación: corre solo cuando se lo ejecuta a mano. Requiere
Docker Compose, Node.js 22 y servicios locales. Desde la raíz del repositorio, iniciá el entorno con
la instrumentación temporal de `ms-flota`:

```powershell
docker compose -f docker-compose.yml -f carga/docker-compose.mediciones.yml up --build -d
npm.cmd run carga:flota -- --modo prueba
```

Para la carga definida en `docs/mediciones.md`, ejecutá:

```powershell
npm.cmd run carga:flota -- --modo completa --escenario carga --repeticion 1 --semilla 42
```

El modo completo dura aproximadamente siete minutos: calentamiento, cinco minutos de medición y
recuperación. Repetilo con `--repeticion 2` y `--repeticion 3`. El escenario `reposo` no manda
actualizaciones de ubicación. Los perfiles sintéticos y sus ubicaciones se eliminan al finalizar;
el destino HTTP y el contexto de Docker deben ser locales. Los informes se guardan en
`carga/resultados/`, excluida de Git. La prueba corta valida que el simulador funcione, pero no
reemplaza las tres ejecuciones de aceptación.

### Pruebas de stress con k6 y tablero Grafana (MED-003 / MED-004)

Con el stack de Docker Compose levantado, podés ejecutar las pruebas de humo, stress, simulación de **100 usuarios distintos** y visualizar las métricas en vivo en **Grafana** (`http://localhost:3300`) sin instalar binarios globales ni golpear APIs externas (`carga/docker-compose.k6.yml` fuerza proveedores internos):

```powershell
# Prueba rápida (~10 s)
npm.cmd run carga:k6:smoke

# Suite combinada de stress (~45 s): viajes + flota + sondas de salud
npm.cmd run carga:k6

# Carga de 100 usuarios distintos (~50 s) enviando métricas a Prometheus + Grafana (:3300)
npm.cmd run carga:k6:100

# Al finalizar las pruebas de carga, restaurar Nginx y ms-tarifas normales (mapa OSRM/Nominatim)
npm.cmd run carga:grafana:down
```

También es compatible con **Grafana Cloud** definiendo `K6_PROMETHEUS_RW_SERVER_URL`, `K6_PROMETHEUS_RW_USERNAME` y `K6_PROMETHEUS_RW_PASSWORD`. Los scripts están en `carga/k6/` (`estimacion-y-viajes.js`, `flota-stress.js`, `stress-combinado.js`, `carga-100-usuarios.js`), los tableros en `carga/grafana/` y sus métricas medidas en [`docs/mediciones.md`](docs/mediciones.md).

---

## 🏛️ Topología de Servicios y Puertos

| Servicio | Puerto Host | Descripción | Endpoints Clave |
|---|---|---|---|
| **`nginx` (API Gateway)** | `8080` | Entrada única pública: sirve la SPA estática (`/`), enruta APIs, proxea WebSocket y blinda rutas internas. | `GET /` (SPA)<br>`GET /health`<br>`GET /ready/*`<br>`GET /tiempo-real`, `GET /ws`<br>`POST /viajes/estimacion`<br>`POST /viajes` |
| **`auth-emulator`** | `9099` | Emulador OIDC / Firebase Auth con claves RSA 2048 y tokens dinámicos. | `GET /.well-known/jwks.json`<br>`GET /auth/tokens-demo`<br>`POST /auth/token` |
| **`jaeger`** | `16686` | Interfaz web de observabilidad distribuida y análisis de latencias. | `http://localhost:16686` (Web UI)<br>`http://localhost:4318` (OTLP) |
| **`ms-viajes`** | *Interno :3000* | Ciclo de vida, asignación atómica concurrente, cobros e idempotencia. | `GET /ready`<br>`POST /viajes`<br>`GET /viajes/:id` |
| **`ms-tarifas`** | *Interno :3001* | Cálculo de tarifa dinámica (BigInt), OSRM/Google/Haversine y Open-Meteo. | `GET /ready`<br>`POST /viajes/estimacion` |
| **`ms-flota`** | *Interno :3002* | Choferes, disponibilidad, geocercanía e historial de ubicaciones GPS. | `GET /ready`<br>`GET /choferes/cercanos` |
| **`postgres`** | *Interno :5432* | Base relacional con esquemas `flota`, `tarifa` y `viajes`. | Conexión con pooling y transacciones |

### Canal WebSocket de viajes

El gateway expone `ws://localhost:8080/tiempo-real` en desarrollo. El handshake requiere JWT: los clientes Node pueden usar `Authorization: Bearer <JWT>` y los navegadores pueden usar los subprotocolos `viajes.v1`, `autenticacion-jwt`, `<JWT>`. El servidor solo negocia `viajes.v1` y nunca recibe el token en la URL. Se envían ofertas al chofer destinatario, cambios de estado a los participantes y ubicación aproximada al pasajero. Al reconectar, recuperar el estado persistido con `GET /viajes/:idViaje` o `GET /choferes/yo/ofertas`.

---

## 🩺 Ciclo de Vida: Arranque, Readiness y Graceful Shutdown

1. **Arranque y Validación:** Todos los microservicios validan sus variables de entorno requeridas al iniciar; si falta una variable obligatoria, el proceso aborta inmediatamente con un mensaje explícito sin dejar estado inconsistente.
2. **Health Check (`GET /health`):** Retorna `200 OK` indicando que el proceso Node.js o el contenedor está vivo.
3. **Readiness Check (`GET /ready`):**
   - Ejecuta una consulta real `SELECT 1` contra el pool de PostgreSQL.
   - Si la base responde exitosamente, devuelve `200 {"estado":"listo"}`.
   - Si la base no responde o está caída, devuelve `503 {"estado":"no_listo"}`.
   - En el API Gateway, se consulta el estado individual mediante `GET /ready/viajes`, `GET /ready/tarifas` y `GET /ready/flota`.
4. **Apagado Limpio (*Graceful Shutdown*):**
   - Todos los microservicios (`ms-viajes`, `ms-tarifas`, `ms-flota` y `auth-emulator`) capturan las señales estándar del sistema operativo `SIGINT` y `SIGTERM`.
   - Al recibirlas, dejan de aceptar nuevas peticiones HTTP, esperan que terminen las transacciones en vuelo y cierran los pools de conexiones a PostgreSQL (`await pool.end()`) limpiamente.

---

## 🎮 Modos de Demostración y Pruebas Manuales

### 1. Demo Web Interactiva con Mapa
```powershell
npm.cmd run demo:web
```
Abre `http://localhost:3000` en tu navegador. Permite buscar origen y destino mediante geocodificación en cascada por cercanía (Gran Resistencia $\rightarrow$ Regional $\rightarrow$ Nacional) o arrastrando el pin interactivo con geocodificación inversa, calcula la tarifa con distancia y duración real, y muestra los factores dinámicos.

### 2. Demo Interactiva por Terminal
```powershell
npm.cmd run demo
```
Permite ingresar rol (pasajero o chofer), coordenadas de origen y destino, y simula todo el ciclo de vida por consola.

### 3. Peticiones REST Reproducibles (.http)
En Visual Studio Code con la extensión *REST Client*:
- **`requests/flujo-e2e.http`:** Ejecución secuencial de todo el flujo (ubicación de chofer $\rightarrow$ disponibilidad $\rightarrow$ estimación $\rightarrow$ confirmación $\rightarrow$ oferta $\rightarrow$ asignación atómica $\rightarrow$ inicio $\rightarrow$ finalización, consulta del recibo y reintento idempotente del cobro).
- **`requests/seguridad-rbac.http`:** Demostración formal de los 3 escenarios obligatorios de seguridad:
  1. `200/201`: Acceso autorizado con token RS256 legítimo.
  2. `401`: Token ausente, firma adulterada o token expirado.
  3. `403`: Rol no autorizado o intento de acceder a recursos privados de otro usuario.

---

## 📚 Documentación de Referencia

- [docs/modelo.md](docs/modelo.md): Entidades, estados, ciclo de vida e invariantes del dominio.
- [docs/api.md](docs/api.md): Contrato HTTP consolidado de endpoints públicos e internos.
- [docs/contratos.md](docs/contratos.md): Convenciones compartidas, formatos de datos y reglas de integración.
- [docs/backlog.md](docs/backlog.md): Estado detallado de las tareas y criterios de aceptación.
- [docs/informe.md](docs/informe.md): Arquitectura, decisiones, resultados de medición y evidencia de seguridad.
- [docs/guion-demo.md](docs/guion-demo.md): Guion cronometrado para ejecutar la demostración del proyecto.
- [docs/ataque.md](docs/ataque.md): Bitácora de ataques controlados y verificación de defensas efectivas.
- [docs/temas-catedra.md](docs/temas-catedra.md): Elección y justificación de temas de cátedra (Temas 4, 18, 19 y 20, y descarte de Tema 1).
- [docs/demo-microservicios.md](docs/demo-microservicios.md): Guía reproducible para demostrar separación en microservicios y caída controlada de `ms-flota`.
- [docs/adr/](docs/adr/): Registro numerado de decisiones arquitectónicas (ADRs).
