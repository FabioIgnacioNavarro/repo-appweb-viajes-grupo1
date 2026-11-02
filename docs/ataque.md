# Bitácora de ataque cruzado y pruebas de penetración

Este archivo registra los intentos controlados de ataque y pruebas de penetración sobre la plataforma, respetando las reglas del enunciado: sin saturación, ingeniería social, acceso no autorizado al repositorio ni ataques fuera del alcance del contrato de la API.

---

## Registro de intentos (Fase de Verificación de Seguridad y RBAC - SEG-002)

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

## Respuesta del defensor y cobertura automatizada

| Identificador | Severidad Acordada | Causa Raíz / Mecanismo de Defensa | Test Automatizado que Verifica el Escenario | Estado |
|---|---|---|---|---|
| **HALLAZGO-SIM-001** (Firma Adulterada) | Alta | `ValidadorJwtJwks` valida la firma asimétrica RS256 de cada token contra el conjunto de claves públicas del endpoint JWKS (`node:crypto.verify`). Claves con `kid` desconocido, algoritmo simétrico no autorizado o firma alterada son descartadas. | `src/compartido/jwt-jwks.test.ts` y `src/ms-viajes/seguridad-rbac.test.ts` (Escenario 2) | Corregido / Blindado |
| **HALLAZGO-SIM-002** (Token Expirado) | Media | Validación explícita del claim estándar `exp` en `ValidadorJwtJwks`. No se permite tolerancia configurable para tokens en el pasado. | `src/compartido/jwt-jwks.test.ts` y `src/ms-viajes/seguridad-rbac.test.ts` (Escenario 2) | Corregido / Blindado |
| **HALLAZGO-SIM-003** (RBAC y Usurpación de Recurso) | Alta | Capa de dominio hexagonal aplica `exigirRol(actor, "CHOFER")` y verificación estricta de propiedad de entidad (`viaje.pasajeroId === actor.idUsuario`). La capa HTTP traduce las violaciones de invariantes de acceso a `403 Forbidden`. | `src/ms-viajes/seguridad-rbac.test.ts` (Escenario 3) y `src/ms-flota/http.test.ts` | Corregido / Blindado |
