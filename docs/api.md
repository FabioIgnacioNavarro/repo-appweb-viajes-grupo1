# Contrato de API HTTP Consolidado

Este documento consolida el contrato de la API HTTP de la plataforma para todos los microservicios (`ms-viajes`, `ms-tarifas`, `ms-flota`) y el API Gateway (`nginx:8080`).

---

## 1. Convenciones Globales

1. **Protocolo y Formato:** Todas las peticiones y respuestas utilizan `application/json; charset=utf-8`.
2. **Nomenclatura:**
   - Rutas HTTP: `kebab-case` en español (ej. `/viajes/estimacion`, `/choferes/yo/disponibilidad`).
   - Parámetros de ruta y query strings: `camelCase` en rutas (`:idViaje`, `:idOferta`) y `snake_case` en query strings (`zona_id`, `ids_choferes`, `radio_metros`).
   - Campos en cuerpos JSON: `snake_case` en español (`id_estimacion`, `precio_estimado`, `factores_precio`).
3. **Moneda e Importes:**
   - Moneda única: Peso Argentino (`ARS`), sin centavos.
   - En JSON, los importes monetarios se exponen como **cadenas de dígitos enteros** (ej. `"8086"` o `"12500"`) para evitar pérdida de precisión de punto flotante (`IEEE 754`).
   - Cada importe va acompañado por su atributo `"moneda": "ARS"`.
   - En el dominio y en PostgreSQL se representan y operan exclusivamente como enteros exactos (`BigInt` / `BIGINT`).
4. **Autenticación y RBAC:**
   - Encabezado estándar: `Authorization: Bearer <token>`.
   - La autenticación es externa (OIDC/JWKS con firma criptográfica asimétrica `RS256` según ADR 0016 y ADR 0054).
   - Los roles soportados son: `PASAJERO`, `CHOFER`, `SOPORTE`, `ADMINISTRADOR`.
   - Ningún servicio implementa formulario ni base de datos de contraseñas.
5. **Idempotencia:**
   - Peticiones con mutaciones de estado o creación de efectos (`POST /viajes`) requieren el encabezado `Clave-Idempotencia: <string>`.
   - Un reintento con la misma clave devuelve de forma determinista la misma respuesta sin duplicar entidades ni cobrar múltiples veces.
6. **Trazabilidad y Observabilidad:**
   - Propagación W3C mediante encabezado `traceparent` (según ADR 0050).
   - El middleware inyecta `X-Trace-Id` en las respuestas de los servicios y correlaciona los logs de eventos.
7. **Sobre Uniforme de Errores:**
   - Todos los errores HTTP (sin excepción) devuelven el esquema estándar:
     ```json
     {
       "error": {
         "codigo": "CODIGO_ESTABLE",
         "mensaje": "Mensaje legible en español.",
         "detalles": {}
       }
     }
     ```
   - Nunca se filtran stack traces, consultas SQL, contraseñas ni secretos internos en las respuestas de error.

---

## 2. Salud, Ciclo de Vida y Readiness

| Método | Ruta Pública (Gateway) | Destino Interno | Propósito |
|---|---|---|---|
| `GET` | `/health` | Gateway local | Verifica que el proceso Nginx está activo. |
| `GET` | `/ready/viajes` | `ms-viajes:3000/ready` | `200` si la base PostgreSQL responde `SELECT 1`; `503` si no está disponible. |
| `GET` | `/ready/tarifas` | `ms-tarifas:3001/ready` | `200` si la base PostgreSQL responde `SELECT 1`; `503` si no está disponible. |
| `GET` | `/ready/flota` | `ms-flota:3002/ready` | `200` si la base PostgreSQL responde `SELECT 1`; `503` si no está disponible. |

### Canal de tiempo real

`GET /tiempo-real` establece una conexión WebSocket con `ms-viajes` (Nginx reenvía el upgrade). El handshake requiere un JWT válido en `Authorization: Bearer <JWT>`. Los clientes de navegador, que no permiten encabezados personalizados en WebSocket, pueden presentar los subprotocolos `viajes.v1`, `autenticacion-jwt`, `<JWT>`; el servidor negocia únicamente `viajes.v1`, nunca devuelve el token. No se aceptan JWT en la URL. El servidor asocia la conexión al `id_usuario` del JWT y no permite elegir otro usuario o viaje en la URL.

Los mensajes son JSON con la envoltura `{"evento":"...","datos":{...}}`:

- `CANAL_LISTO`: confirma que el usuario autenticado quedó conectado.
- `OFERTA_NUEVA`: se entrega únicamente al chofer destinatario. `datos` incluye `id_oferta`, `id_viaje`, `estado`, `enviada_en` y `expira_en`.
- `OFERTA_VENCIDA`: se entrega al chofer cuando el servidor observa el vencimiento (al consultar o aceptar); incluye `id_oferta`, `id_viaje`, `estado`, `motivo` y `actualizado_en`. El cliente usa `expira_en` para marcar el vencimiento local en el instante indicado y consulta el GET al reconectar.
- `OFERTA_CANCELADA`: se entrega a los choferes con ofertas pendientes cuando el viaje se asigna a otro chofer o se cancela. Incluye `id_oferta`, `id_viaje`, `estado`, `motivo` y `actualizado_en`.
- `ESTADO_VIAJE_ACTUALIZADO`: se entrega al pasajero y al chofer asignado. `datos` incluye `id_viaje`, `estado`, `id_chofer` y `actualizado_en`.
- `UBICACION_CHOFER_ACTUALIZADA`: se entrega al pasajero del viaje activo. Incluye `id_viaje`, `latitud`, `longitud` redondeadas a tres decimales y `actualizado_en`; no expone la posición precisa almacenada por Flota.

El canal no conserva eventos ni reemplaza la API de consulta. Después de conectar o reconectar, el cliente restaura el estado real con `GET /viajes/:idViaje` o `GET /choferes/yo/ofertas` usando el mismo JWT y luego aplica los mensajes nuevos. El GET de ofertas materializa y notifica los vencimientos que observa. Si el token es inválido, el handshake termina con `401`. La notificación es de mejor esfuerzo y no cambia el resultado de una operación ya persistida.

Ruta interna entre servicios, bloqueada por Nginx desde el exterior:

#### `POST /interno/viajes/ubicacion-chofer`

`ms-flota` llama esta ruta con el JWT original del chofer y la ubicación ya persistida. `ms-viajes` valida el rol, busca la asignación activa del chofer y solo si el viaje está `CHOFER_EN_CAMINO` o `EN_CURSO` emite al pasajero la ubicación aproximada (`202`). Sin viaje en seguimiento devuelve `204`; otros roles reciben `403`. Una falla de esta notificación no revierte la actualización en Flota.

---

## 3. Catálogo de Endpoints Públicos (API Gateway :8080)

### 3.1 Servicio `ms-tarifas` (Estimación y Precios)

#### `POST /viajes/estimacion`
Calcula la tarifa estimada con multiplicador dinámico por demanda, distancia, duración, lluvia y franja horaria.
- **Autorización:** Requiere rol `PASAJERO`.
- **Cuerpo recibido:**
  ```json
  {
    "origen": { "latitud": -27.451, "longitud": -58.986 },
    "destino": { "latitud": -27.462, "longitud": -58.993 }
  }
  ```
  *Nota: Admite también resolución por texto:* `{"direccion": "Av. Alberdi 250, Resistencia"}`.
- **Respuesta exitosa (`201 Created`):**
  ```json
  {
    "id_estimacion": "uuid-estimacion",
    "precio_estimado": "3700",
    "moneda": "ARS",
    "distancia_metros": 2500,
    "duracion_segundos": 300,
    "multiplicador_demanda": 1.2,
    "zona": "Resistencia",
    "factores_precio": {
      "zona_id": "resistencia",
      "choferes_disponibles": 5,
      "solicitudes_activas": 2,
      "precipitacion_mm": 0,
      "llueve": false,
      "fuente_clima": "OPEN_METEO",
      "clima_observado_en": "2026-11-02T13:00:00.000Z",
      "franja_horaria": "siesta",
      "factor_lluvia": 1.0,
      "factor_disponibilidad": 1.1,
      "factor_demanda": 1.0,
      "factor_horario": 0.95
    },
    "version_regla": 1,
    "creada_en": "2026-11-02T13:00:00.000Z",
    "vigente_hasta": "2026-11-02T13:03:00.000Z",
    "origen": { "latitud": -27.451, "longitud": -58.986 },
    "destino": { "latitud": -27.462, "longitud": -58.993 },
    "polilinea": "encoded_polyline_o_null"
  }
  ```

---

### 3.2 Servicio `ms-viajes` (Ciclo de Vida del Viaje y Ofertas)

#### `POST /viajes`
Confirma la solicitud de un viaje a partir de una estimación vigente. Congela el precio y los factores de auditoría de forma inmutable.
- **Autorización:** Requiere rol `PASAJERO`.
- **Encabezados:** `Clave-Idempotencia: <string>`.
- **Cuerpo recibido:** `{"id_estimacion": "uuid-estimacion"}`.
- **Respuesta (`201 Created`):** Objeto Viaje con estado `"solicitado"`.

#### `GET /viajes`
Lista los viajes propios del usuario autenticado (o todos si es `ADMINISTRADOR`/`SOPORTE`).
- **Respuesta (`200 OK`):** `{"viajes": [ ... ]}`.

#### `GET /viajes/:idViaje`
Consulta el detalle de un viaje específico.
- **Autorización:** Solo el pasajero creador, el chofer asignado, `SOPORTE` o `ADMINISTRADOR`.
- **Respuesta (`200 OK`):** Objeto Viaje detallado. Si no pertenece al actor $\rightarrow$ `403 VIAJE_NO_AUTORIZADO`.

#### `POST /viajes/:idViaje/cancelacion`
Cancela un viaje activo según reglas de transición.
- **Cuerpo:** `{"motivo": "string opcional"}`.
- **Respuesta (`200 OK`):** Viaje en estado `"cancelado"`.

#### `POST /viajes/:idViaje/llegada`
El chofer asignado marca su llegada al punto de encuentro.
- **Autorización:** Exclusivo del `CHOFER` asignado. Transiciona de `ASIGNADO` a `CHOFER_EN_CAMINO`.
- **Respuesta (`200 OK`):** Viaje en estado `"chofer_en_camino"`.

#### `POST /viajes/:idViaje/inicio`
El chofer inicia el recorrido con el pasajero a bordo.
- **Autorización:** Exclusivo del `CHOFER` asignado. Transiciona a `EN_CURSO`.
- **Respuesta (`200 OK`):** Viaje en estado `"en_curso"`.

#### `POST /viajes/:idViaje/finalizacion`
El chofer finaliza el viaje, fijando el precio final y generando el cobro único.
- **Autorización:** Exclusivo del `CHOFER` asignado. Transiciona a `FINALIZADO`.
- **Respuesta (`200 OK`):** `{ "viaje": { ... }, "cobro": { ... } }`.

#### `GET /choferes/yo/ofertas`
Lista las ofertas vigentes enviadas al chofer autenticado.
- **Autorización:** Exclusivo del rol `CHOFER`.
- **Respuesta (`200 OK`):** `{"ofertas": [ ... ]}`.

#### `POST /choferes/yo/ofertas/:idOferta/aceptacion`
El chofer acepta una oferta de viaje antes de su vencimiento (60 segundos).
- **Autorización:** Exclusivo del `CHOFER` destinatario de la oferta.
- **Respuesta (`200 OK`):** Objeto Viaje transicionado a `ASIGNADO`.

#### `POST /choferes/yo/ofertas/:idOferta/rechazo`
El chofer rechaza la oferta explícitamente.
- **Respuesta (`200 OK`):** Objeto Oferta en estado `"rechazada"`.

---

### 3.3 Servicio `ms-flota` (Choferes y Ubicaciones)

#### `PATCH /choferes/yo/disponibilidad`
Cambia el estado de disponibilidad del chofer autenticado.
- **Autorización:** Exclusivo de rol `CHOFER` habilitado.
- **Cuerpo:** `{"disponibilidad": true}` o `{"disponibilidad": false}`.
- **Respuesta (`200 OK`):** Datos del chofer con nueva disponibilidad.

#### `POST /choferes/yo/ubicacion`
Registra la posición GPS actual del chofer.
- **Autorización:** Exclusivo de rol `CHOFER` habilitado.
- **Cuerpo:** `{"latitud": -27.451, "longitud": -58.986, "actualizado_at"?: ISO-8601, "precision_metros"?: number}`.
- **Respuesta (`200 OK`):** Última ubicación guardada.

#### `GET /choferes/cercanos?latitud=&longitud=&radio_metros=`
Busca choferes habilitados, disponibles, con ubicación reciente y sin viaje activo en la zona.
- **Respuesta (`200 OK`):** `{ "candidatos": [ { "id_chofer": "...", "distancia_metros": 850, "ubicacion_actualizada_at": "..." } ] }`. No expone coordenadas privadas.

#### `GET /choferes/:idChofer`
Consulta de ubicación y perfil sujeta a autorización por recurso.
- **Respuesta (`200 OK`):** `{ "chofer": { ... }, "ubicacion": { ... } }`. Si el actor no tiene autorización sobre ese chofer $\rightarrow$ `403 UBICACION_NO_AUTORIZADA`.

---

## 4. Endpoints Internos y Protección en el API Gateway

Las siguientes rutas **no deben ser accesibles desde el exterior**. El API Gateway Nginx las intercepta y devuelve `404 RUTA_NO_ENCONTRADA`:

| Endpoint Interno | Proveedor | Consumidor | Propósito |
|---|---|---|---|
| `GET /interno/demanda-por-zona?zona_id=` | `ms-viajes` | `ms-tarifas` | Consulta solicitudes activas en la zona para el cálculo dinámico. |
| `GET /interno/choferes/ocupados?ids_choferes=` | `ms-viajes` | `ms-flota` | Excluye choferes que tienen viaje activo (`ASIGNADO`, `CHOFER_EN_CAMINO`, `EN_CURSO`). |
| `GET /estimaciones/:idEstimacion` | `ms-tarifas` | `ms-viajes` | Recupera la estimación vigente para congelar precio al confirmar. |

---

## 5. Matriz Exhaustiva de Códigos HTTP y Códigos de Dominio

| Código HTTP | Significado | Código de Dominio (`error.codigo`) | Situación en que se produce |
|---|---|---|---|
| **`400`** | Bad Request | `ENTRADA_INVALIDA` | Cuerpo malformado, campos no permitidos o tipos erróneos. |
| **`400`** | Bad Request | `COORDENADAS_INVALIDAS` | Latitud o longitud fuera de rango (-90..90, -180..180). |
| **`400`** | Bad Request | `DIRECCION_INVALIDA` | Dirección vacía o no resoluble sintácticamente. |
| **`400`** | Bad Request | `CLAVE_IDEMPOTENCIA_REQUERIDA` | Falta encabezado `Clave-Idempotencia` en mutación. |
| **`400`** | Bad Request | `RADIO_INVALIDO` / `PRECISION_INVALIDA` | Parámetros numéricos fuera de límites en ms-flota. |
| **`401`** | Unauthorized | `TOKEN_REQUERIDO` | Encabezado `Authorization` ausente o sin formato `Bearer`. |
| **`401`** | Unauthorized | `TOKEN_INVALIDO` | Firma RS256 alterada, token expirado (`exp`), emisor/audiencia ajenos o clave `kid` desconocida. |
| **`403`** | Forbidden | `ROL_NO_AUTORIZADO` | Usuario autenticado intentando invocar endpoint de otro rol (ej. Pasajero en endpoint de chofer). |
| **`403`** | Forbidden | `VIAJE_NO_AUTORIZADO` | Intento de consultar o avanzar un viaje perteneciente a otro usuario. |
| **`403`** | Forbidden | `OFERTA_NO_AUTORIZADA` | Intento de responder oferta dirigida a otro chofer. |
| **`403`** | Forbidden | `UBICACION_NO_AUTORIZADA` | Intento de consultar coordenadas privadas de chofer sin viaje asignado. |
| **`403`** | Forbidden | `ESTIMACION_NO_AUTORIZADA` | Intento de consultar estimación solicitada por otro pasajero. |
| **`404`** | Not Found | `VIAJE_NO_ENCONTRADO` | El identificador de viaje no existe en el sistema. |
| **`404`** | Not Found | `OFERTA_NO_ENCONTRADA` | La oferta solicitada no existe. |
| **`404`** | Not Found | `CHOFER_NO_ENCONTRADO` | El chofer no está registrado. |
| **`404`** | Not Found | `ESTIMACION_NO_ENCONTRADA` | La estimación solicitada no existe. |
| **`404`** | Not Found | `DIRECCION_NO_ENCONTRADA` | El geocodificador no halló resultados para el texto. |
| **`404`** | Not Found | `RUTA_NO_ENCONTRADA` | Ruta inexistente o interceptada como ruta interna en Gateway. |
| **`409`** | Conflict | `ESTIMACION_VENCIDA` | Se intentó confirmar un viaje tras superar los 3 minutos de vigencia. |
| **`409`** | Conflict | `OFERTA_VENCIDA` / `OFERTA_NO_DISPONIBLE` | La oferta superó los 60s o ya fue respondida. |
| **`409`** | Conflict | `ASIGNACION_EN_CONFLICTO` | Carrera concurrente: otro chofer ganó la asignación o el chofer ya tiene viaje activo. |
| **`409`** | Conflict | `CHOFER_NO_HABILITADO` | Chofer con carnet no validado o inhabilitado administrativamente. |
| **`422`** | Unprocessable Entity | `TRANSICION_INVALIDA` | Cambio de estado de viaje prohibido por la máquina de estados. |
| **`422`** | Unprocessable Entity | `IMPORTE_INVALIDO` / `REGLA_INVALIDA` | Parámetros matemáticos o de regla fuera de rango permitido. |
| **`422`** | Unprocessable Entity | `ZONA_NO_ENCONTRADA` | Coordenadas fuera de cobertura de las zonas tarifarias activas. |
| **`503`** | Service Unavailable | `DEPENDENCIA_NO_DISPONIBLE` | Falla o timeout al consultar PostgreSQL, OSRM, Google Routes, Open-Meteo o microservicio hermano. |
| **`500`** | Internal Server Error | `ERROR_INTERNO` | Error imprevisto en la ejecución del servidor. |
