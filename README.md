# Plataforma Backend de Viajes — Programación IV (Grupo 1)

Plataforma backend de viajes en tiempo real construida bajo **Arquitectura Hexagonal**, microservicios en **Node.js 22 LTS / TypeScript**, base de datos relacional **PostgreSQL**, observabilidad distribuida con **OpenTelemetry y Jaeger**, y autenticación externa basada en **OIDC/JWKS y RBAC**.

Incluye la **Variante Obligatoria A (Precio dinámico por demanda auditado)** y los temas especiales de cátedra:
- **Tema 18:** Observabilidad distribuida con OpenTelemetry, SDK OTLP, propagación de contexto W3C `traceparent` y servidor Jaeger.
- **Tema 19:** Emulador de Identidad JWKS, emisión asimétrica RS256, roles RBAC y control de acceso por recurso.

---

## 🚀 Secuencia de Clon Limpio (Paso a Paso)

Para reproducir el entorno desde un clon limpio de forma 100% determinista:

### 1. Clonar y configurar variables de entorno
```powershell
git clone https://github.com/FabioIgnacioNavarro/repo-appweb-viajes-grupo1.git
cd repo-appweb-viajes-grupo1

# Crear archivo de configuración local a partir de la plantilla
Copy-Item .env.example .env
```

### 2. Instalar dependencias y compilar TypeScript
```powershell
npm.cmd install
npm.cmd run build
```

### 3. Levantar la plataforma completa en Docker Compose
```powershell
docker compose config
docker compose up --build -d
```
Docker Compose inicializa automáticamente:
1. **`postgres`:** Aplica los esquemas DDL de los tres servicios (`src/ms-flota/schema.sql`, `src/ms-tarifas/schema.sql`, `src/ms-viajes/schema.sql`).
2. **`jaeger`:** Levanta el recolector OTLP y la interfaz gráfica de trazas.
3. **`auth-emulator`:** Inicializa las claves RSA 2048 y publica el endpoint JWKS.
4. **`ms-viajes`**, **`ms-tarifas`**, **`ms-flota`:** Conectan a PostgreSQL y quedan listos.
5. **`nginx`:** Expone el API Gateway unificado en el puerto `8080`.

### 4. Ejecutar la suite completa de pruebas
```powershell
# Ejecuta todas las pruebas unitarias y de integración offline (94 tests)
npm.cmd test
```

### 5. Ejecutar la suite E2E contra el API Gateway
```powershell
$env:E2E_BASE_URL = "http://localhost:8080"
npm.cmd run test:e2e
```

---

## 🏛️ Topología de Servicios y Puertos

| Servicio | Puerto Host | Descripción | Endpoints Clave |
|---|---|---|---|
| **`nginx` (API Gateway)** | `8080` | Entrada única pública con enrutamiento y blindaje de rutas internas. | `GET /health`<br>`GET /ready/*`<br>`POST /viajes/estimacion`<br>`POST /viajes` |
| **`auth-emulator`** | `9099` | Emulador OIDC / Firebase Auth con claves RSA 2048 y tokens dinámicos. | `GET /.well-known/jwks.json`<br>`GET /auth/tokens-demo`<br>`POST /auth/token` |
| **`jaeger`** | `16686` | Interfaz web de observabilidad distribuida y análisis de latencias. | `http://localhost:16686` (Web UI)<br>`http://localhost:4318` (OTLP) |
| **`ms-viajes`** | *Interno :3000* | Ciclo de vida, asignación atómica concurrente, cobros e idempotencia. | `GET /ready`<br>`POST /viajes`<br>`GET /viajes/:id` |
| **`ms-tarifas`** | *Interno :3001* | Cálculo de tarifa dinámica (BigInt), OSRM/Google/Haversine y Open-Meteo. | `GET /ready`<br>`POST /viajes/estimacion` |
| **`ms-flota`** | *Interno :3002* | Choferes, disponibilidad, geocercanía e historial de ubicaciones GPS. | `GET /ready`<br>`GET /choferes/cercanos` |
| **`postgres`** | *Interno :5432* | Base relacional con esquemas `flota`, `tarifa` y `viajes`. | Conexión con pooling y transacciones |

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
- **`requests/flujo-e2e.http`:** Ejecución secuencial de todo el flujo (ubicación de chofer $\rightarrow$ disponibilidad $\rightarrow$ estimación $\rightarrow$ confirmación $\rightarrow$ oferta $\rightarrow$ asignación atómica $\rightarrow$ inicio $\rightarrow$ finalización y cobro).
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
- [docs/ataque.md](docs/ataque.md): Bitácora de ataques controlados y verificación de defensas efectivas.
- [docs/adr/](docs/adr/): Registro numerado de decisiones arquitectónicas (ADRs).
