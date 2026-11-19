# Plataforma Backend de Viajes — Programación IV (Grupo 1)

Plataforma backend de viajes en tiempo real construida bajo **Arquitectura Hexagonal**, microservicios en **Node.js 22 LTS / TypeScript**, base de datos relacional **PostgreSQL**, observabilidad distribuida con **OpenTelemetry y Jaeger**, y autenticación externa basada en **OIDC/JWKS y RBAC**.

Incluye la **Variante Obligatoria A (Precio dinámico por demanda auditado)** y los temas especiales de cátedra:
- **Tema 18:** Observabilidad distribuida con OpenTelemetry, SDK OTLP, propagación de contexto W3C `traceparent` y servidor Jaeger.
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

### 2. Instalar dependencias y compilar TypeScript
```powershell
npm.cmd ci
npm.cmd run build
```

### 3. Validar y levantar la plataforma completa en Docker Compose
```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

Compose inicializa automáticamente los esquemas de los tres servicios y carga un chofer sintético de prueba. Esperá a que `postgres`, el emulador de identidad, los tres microservicios y el gateway figuren saludables. Luego comprobá el acceso público:

```powershell
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod http://localhost:8080/ready/viajes
Invoke-RestMethod http://localhost:8080/ready/tarifas
Invoke-RestMethod http://localhost:8080/ready/flota
```

El emulador ofrece actores sintéticos para la demo. Los tokens del proveedor falso solo se aceptan en desarrollo; no usar ese modo en producción.

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

El Compose monta los esquemas de Flota, Tarifas y Viajes en `/docker-entrypoint-initdb.d`; PostgreSQL los ejecuta al crear un volumen vacío. Un volumen existente no vuelve a ejecutar scripts nuevos. En ese caso, aplicar las migraciones/esquemas correspondientes antes de repetir la demo.

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
- [docs/adr/](docs/adr/): Registro numerado de decisiones arquitectónicas (ADRs).
