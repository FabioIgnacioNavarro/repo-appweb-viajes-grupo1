# Bitácora de ataque cruzado y pruebas de penetración

Este archivo registra la guía del entorno reproducible para evaluación cruzada, las reglas de alcance y los intentos controlados de ataque y pruebas de penetración sobre la plataforma, respetando las reglas del enunciado: sin saturación, ingeniería social, acceso no autorizado al repositorio ni ataques fuera del alcance del contrato de la API.

---

## 1. Guía del entorno para ataque cruzado (SEG-003)

### 1.1 Levantar el entorno reproducible

1. Copiar `.env.example` a `.env` en la raíz del repositorio:
   - Para pruebas con validación criptográfica RS256 estricta contra el emulador JWKS, configurar `JWT_MODO=real` en `.env`.
2. Construir y levantar la pila completa detrás del API Gateway:
   ```bash
   docker compose up -d --build
   ```
3. Puntos de entrada expuestos para evaluación externa:
   - **API Gateway Nginx + SPA Web:** `http://localhost:8080`
   - **Emulador de Identidad y JWKS:** `http://localhost:9099` (también proxeado en `http://localhost:8080/auth/`)
   - **Jaeger UI (trazas distribuidas):** `http://localhost:16686`
4. Verificación rápida de disponibilidad:
   - `GET http://localhost:8080/health` (`200`)
   - `GET http://localhost:9099/.well-known/jwks.json` (`200`, clave pública RSA `kid`)

### 1.2 Tokens de prueba por rol y contratos reproducibles

- Catálogo rápido de tokens RS256: `GET http://localhost:9099/auth/tokens-demo`
- Emisión dinámica por rol (`pasajero`, `chofer`, `soporte`, `administrador`):
  ```http
  POST http://localhost:9099/auth/token
  Content-Type: application/json

  {
    "id_usuario": "usr-evaluador-1",
    "rol": "pasajero",
    "expira_en_segundos": 3600
  }
  ```
- La colección de peticiones reproducibles por escenario (`401`, `403`, `413`, encabezados de seguridad) está disponible en [`requests/seguridad-rbac.http`](../requests/seguridad-rbac.http) y el contrato público completo en [`docs/api.md`](./api.md).

### 1.3 Alcance permitido y reglas del enunciado

- **Dentro del alcance:** endpoints públicos documentados en `docs/api.md` vía Gateway (`:8080`), canal WebSocket (`/ws`, `/tiempo-real`), emulador de autenticación (`:9099`), vistas web servidas por Nginx y validación de controles declarados (JWT RS256, RBAC, aislamiento entre recursos, validación de entradas, límites de payload, tasa y XSS/CSP).
- **Fuera del alcance:** ataques de denegación de servicio / saturación masiva (`flooding` por encima del límite razonable documentado), acceso directo a contenedores internos o puertos de PostgreSQL no publicados al exterior, manipulación del código fuente del repositorio o ingeniería social.

### 1.4 Controles de defensa activos en Gateway, Backend y Front

| Capa | Control implementado | Evidencia / Verificación |
|---|---|---|
| Gateway (`nginx.conf`) | `client_max_body_size 16k`, rate limiting (`30r/s` API, `10r/s` `/auth/`, respuesta JSON `429`), bloqueo de `/interno/*` y `/estimaciones/*` (`404`), `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. | `tests/e2e/gateway-config.test.ts` |
| Backend (`ms-viajes`, `ms-tarifas`, `ms-flota`, `auth-emulator`) | Límite estricto de JSON (`express.json({ limit: "10kb" \| "20kb" })`), traducción uniforme de `413 PAYLOAD_DEMASIADO_GRANDE` y `400 ENTRADA_INVALIDA` sin stack traces (`src/compartido/seguridad-http.ts`), validación RS256 + RBAC + autorización por recurso. | `tests/compartido/seguridad-http.test.ts`, `tests/ms-viajes/seguridad-rbac.test.ts` |
| Frontend (`web/src/`) | Renderizado React escapado sin `dangerouslySetInnerHTML`/`innerHTML`; popups de Leaflet construidos con nodos DOM y `textContent`; JWT transmitido únicamente por `Authorization: Bearer` y subprotocolo WS (`["viajes-jwt", token]`), nunca en URL ni querystring. | `tests/playwright/seguridad-hardening.spec.ts` |

---

## 2. Proceso de registro y respuesta ante hallazgos recibidos

Cada hallazgo reportado por el grupo evaluador o detectado en auditoría interna se documenta y resuelve siguiendo estos pasos obligatorios:

1. **Reproducción y registro inmediato:** incorporar una entrada numerada (`Intento NNN`) en la sección siguiente con hipótesis, petición HTTP o payload exacto, resultado obtenido y severidad acordada (`Alta`, `Media`, `Baja`).
2. **Clasificación de causa raíz:** identificar el punto exacto del dominio, adaptador HTTP, gateway Nginx o interfaz web afectado.
3. **Parche y prueba de regresión:** antes de cerrar el hallazgo, agregar una prueba automatizada que falle sin el parche y pase con él (`npm.cmd test` o Playwright).
4. **Cierre en tabla de estado:** actualizar el estado a `Corregido / Blindado` en la tabla de respuesta vinculando el archivo de test que lo cubre.

---

## 3. Registro de intentos (SEG-002 y SEG-003)

### Intento 001 — 2026-11-02

- **Hipótesis:** Un atacante malicioso puede modificar el payload de un token JWT legítimo (por ejemplo cambiando `rol` a `ADMINISTRADOR` o `idUsuario` a la víctima) y enviar la petición confiando en que el servicio valida únicamente la estructura sintáctica del token sin comprobar criptográficamente la firma RS256 contra las claves públicas del JWKS.
- **Petición exacta:**
  - **Método y URL:** `POST http://localhost:8080/viajes` (o `POST /viajes` en `ms-viajes`)
  - **Encabezados relevantes:**
    - `Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6ImVtdWxhZG9yLWF1dGgtdjEifQ...[payload modificado con firma alterada]`
    - `Clave-Idempotencia: ataque-001`
    - `Content-Type: application/json`
  - **Cuerpo:** `{"id_estimacion":"estimacion-prueba-1"}`
- **Resultado esperado por el atacante:** Creación de viaje o escalamiento de privilegios sin credenciales legítimas (HTTP 201).
- **Resultado obtenido:** `HTTP 401 Unauthorized` con cuerpo `{"error":{"codigo":"TOKEN_INVALIDO","mensaje":"El token no es válido.","detalles":{}}}`. El middleware intercepta la firma criptográfica inválida mediante `crypto.verify("sha256", data, publicKey, signature)` y aborta el procesamiento de forma inmediata sin tocar la base de datos ni el dominio.
- **Veredicto:** **defensa efectiva**
- **Severidad:** Alta (evitada)
- **Impacto:** Ninguno. La verificación criptográfica asimétrica RS256 en `ValidadorJwtJwks` previene cualquier manipulación de claims en tránsito.

---

### Intento 002 — 2026-11-02

- **Hipótesis:** Un token JWT emitido legítimamente en el pasado puede ser capturado por un atacante e inyectado repetidamente fuera de su ventana de vigencia (`exp < now`) para mantener acceso indefinido a las operaciones de la víctima.
- **Petición exacta:**
  - **Método y URL:** `GET http://localhost:8080/viajes`
  - **Encabezados relevantes:**
    - `Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6ImVtdWxhZG9yLWF1dGgtdjEifQ...[token con exp = now - 60s]`
- **Resultado esperado por el atacante:** Acceso a los viajes privados del pasajero (HTTP 200).
- **Resultado obtenido:** `HTTP 401 Unauthorized` con código `TOKEN_INVALIDO`.
- **Veredicto:** **defensa efectiva**
- **Severidad:** Media (evitada)
- **Impacto:** Ninguno. `ValidadorJwtJwks` evalúa `exp` estricto contra el tiempo de la máquina y rechaza inmediatamente tokens vencidos.

---

### Intento 003 — 2026-11-02

- **Hipótesis:** Un usuario autenticado con rol `PASAJERO` puede enviar peticiones a endpoints operacionales de choferes (`PATCH /choferes/yo/disponibilidad` o `POST /choferes/yo/ofertas/:idOferta/aceptacion`), o puede consultar/manipular viajes ajenos mediante manipulación de parámetros (IDOR / Broken Object Level Authorization).
- **Petición exacta:**
  - **Método y URL:** `PATCH http://localhost:8080/choferes/yo/disponibilidad` (o `GET /viajes/:idViaje` para viaje de otro pasajero)
  - **Encabezados relevantes:**
    - `Authorization: Bearer [Token RS256 válido con claims: { idUsuario: "usr-pasajero-1", rol: "pasajero" }]`
    - `Content-Type: application/json`
  - **Cuerpo:** `{"disponibilidad": true}`
- **Resultado esperado por el atacante:** Activación ilegítima de estado de conductor por parte de un cliente no registrado como chofer, o acceso a datos de geolocalización/recorridos ajenos.
- **Resultado obtenido:**
  - En endpoint de chofer: `HTTP 403 Forbidden` con código `ROL_NO_AUTORIZADO`.
  - En consulta de viaje ajeno: `HTTP 403 Forbidden` con código `VIAJE_NO_AUTORIZADO`.
- **Veredicto:** **defensa efectiva**
- **Severidad:** Alta (evitada)
- **Impacto:** Ninguno. La regla de RBAC y autorización por recurso en el dominio valida tanto el rol necesario como la titularidad del recurso (`pasajeroId === actor.idUsuario` o `choferId === actor.idUsuario`).

---

### Intento 004 — 2026-11-19 (SEG-003)

- **Hipótesis:** Un cliente envía un payload JSON sobredimensionado (> 16 KB al Gateway o > 10 KB al servicio de tarifas/flota/auth) o JSON malformado para provocar consumo excesivo de memoria o filtración de stack traces HTML de Express.
- **Petición exacta:**
  - **Método y URL:** `POST http://localhost:8080/auth/token` y `PUT http://localhost:8080/reglas/demanda`
  - **Cuerpo:** objeto JSON de > 17 KB (o JSON sintácticamente inválido `{"origen":`).
- **Resultado esperado por el atacante:** Consumo de memoria o respuesta HTML 500 con stack trace de Express.
- **Resultado obtenido:** Gateway rechaza > 16 KB con `413`; cada microservicio y `auth-emulator` aplica `limit: "10kb"` / `"20kb"` y responde el sobre JSON uniforme `413 PAYLOAD_DEMASIADO_GRANDE` o `400 ENTRADA_INVALIDA` sin trazas internas.
- **Veredicto:** **defensa efectiva** (endurecida con `src/compartido/seguridad-http.ts` y límite explícito `10kb` en `auth-emulator`)
- **Severidad:** Media

---

### Intento 005 — 2026-11-19 (SEG-003 — Auditoría interna de front)

- **Hipótesis:** Un pasajero malicioso o un proveedor geocodificador comprometido introduce etiquetas HTML/JS (`<img src=x onerror=window.__xss=true>`) en el texto de ubicación mostrado dentro del popup del mapa Leaflet (`MapaLeaflet.tsx`), buscando ejecución de XSS almacenado/reflejado en el navegador.
- **Petición / vector exacto:** Inyección de `<img src=x onerror=window.__xssDisparado=true>` en el atributo `titulo` de marcador pasado a `marker.bindPopup(...)` y en campos mostrados en tablas de Operador/Admin (`pasajero_id`, `autor`).
- **Resultado antes de la corrección:** `MapaLeaflet.tsx` interpolaba `${origen.titulo}`, `${destino.titulo}` y `${posicionChofer.titulo}` en un template HTML pasado a `marker.bindPopup(...)`.
- **Resultado obtenido tras la corrección:** Reemplazado por `construirContenidoPopup(...)` usando `document.createElement` y `textContent`/`createTextNode`, más CSP estricta en Nginx (`script-src 'self'; object-src 'none'; frame-ancestors 'none'`). Ningún nodo HTML inyectado se interpreta ni ejecuta scripts.
- **Veredicto:** **hallazgo detectado y corregido**
- **Severidad:** Alta

---

## 4. Respuesta del defensor y cobertura automatizada

| Identificador | Severidad Acordada | Causa Raíz / Mecanismo de Defensa | Test Automatizado que Verifica el Escenario | Estado |
|---|---|---|---|---|
| **HALLAZGO-SIM-001** (Firma Adulterada) | Alta | `ValidadorJwtJwks` valida la firma asimétrica RS256 de cada token contra el conjunto de claves públicas del endpoint JWKS (`node:crypto.verify`). Claves con `kid` desconocido, algoritmo simétrico no autorizado o firma alterada son descartadas. | `tests/compartido/jwt-jwks.test.ts` y `tests/ms-viajes/seguridad-rbac.test.ts` | Corregido / Blindado |
| **HALLAZGO-SIM-002** (Token Expirado) | Media | Validación explícita del claim estándar `exp` en `ValidadorJwtJwks`. No se permite tolerancia configurable para tokens en el pasado. | `tests/compartido/jwt-jwks.test.ts` y `tests/ms-viajes/seguridad-rbac.test.ts` | Corregido / Blindado |
| **HALLAZGO-SIM-003** (RBAC y Usurpación de Recurso) | Alta | Capa de dominio hexagonal aplica `exigirRol(...)` y verificación estricta de propiedad de entidad (`viaje.pasajeroId === actor.idUsuario`). La capa HTTP traduce violaciones a `403 Forbidden`. | `tests/ms-viajes/seguridad-rbac.test.ts` y `tests/ms-flota/http.test.ts` | Corregido / Blindado |
| **HALLAZGO-SEG-004** (Payloads grandes y fugas JSON) | Media | Límite de 16 KB en `nginx.conf`, límites `10kb`/`20kb` en servicios (incluyendo `auth-emulator`), rate limiting `429` en Gateway y middleware `manejarErrorCuerpoHttp` sin stack traces. | `tests/e2e/gateway-config.test.ts` y `tests/compartido/seguridad-http.test.ts` | Corregido / Blindado |
| **HALLAZGO-SEG-005** (DOM-XSS en popup Leaflet y CSP) | Alta | Reemplazo de strings HTML en `MapaLeaflet.tsx` por nodos DOM con `textContent`, encabezado `Content-Security-Policy` / `X-Frame-Options` en `nginx.conf` y verificación de ausencia de JWT en URLs/WS. | `tests/playwright/seguridad-hardening.spec.ts` | Corregido / Blindado |
