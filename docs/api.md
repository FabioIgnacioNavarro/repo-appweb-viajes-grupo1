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
| `GET` | `/` (y rutas SPA) | Estáticos Nginx (`dist/web`) | Sirve `index.html`, `/assets/*` con MIME types correctos y fallback a `index.html` para rutas del front. |
| `POST` | `/auth/login` | `auth-emulator:9099` | Valida `{ usuario, contrasena }` contra cuentas semilla locales y devuelve JWT RS256 + perfil. Solo disponible fuera de producción. |
| `POST` | `/auth/token` | `auth-emulator:9099` | Emite un JWT RS256 de desarrollo/demo para `{ id_usuario, rol }` (también acepta `idUsuario`). Solo entorno con emulador. |
| `GET` | `/auth/tokens-demo` | `auth-emulator:9099` | Devuelve catálogo de tokens RS256 sintéticos de demostración por rol. |

### Cabeceras y límites del API Gateway

Nginx agrega cabeceras de seguridad a las respuestas del frontend y de la API. La CSP usa
`default-src 'self'`, permite scripts y hojas de estilo solo desde el mismo origen, bloquea objetos
con `object-src 'none'` y prohíbe que la aplicación se muestre dentro de marcos (`frame-ancestors
'none'`). Los scripts no aceptan `'unsafe-inline'` ni `'unsafe-eval'`. Las imágenes externas se
limitan a `https://tile.openstreetmap.org`; se permite `data:` solo porque Leaflet usa un GIF
transparente como marcador temporal al cargar los mosaicos. Las conexiones WebSocket de la demo se
limitan a `localhost:8080` y `127.0.0.1:8080`.

Leaflet genera estilos en línea para los pines del mapa. Se permiten solo sus valores actuales,
identificados por hashes SHA-256 en `style-src-attr`; no se habilita una excepción general para
estilos en línea. La prueba de configuración del gateway compara los hashes con
`web/src/componentes/mapa/MapaLeaflet.tsx`, así que cualquier cambio de esos estilos debe actualizar
la CSP junto con la prueba. Si se agrega otro origen de tiles, fuentes o conexiones, debe agregarse
explícitamente después de verificar que la interfaz lo necesita.

| Grupo de rutas | Límite de Nginx | Tiempos máximos del proxy |
|---|---|---|
| API general | `30` solicitudes/segundo, ráfaga de `60` | Conexión `1,5 s` (`/viajes/estimacion`: `1,8 s`), lectura `4 s` (geocodificación inversa: `5 s`) |
| `/auth/` | `10` solicitudes/segundo, ráfaga de `20` | Conexión `1,5 s`, lectura `4 s` |
| WebSocket `/tiempo-real` y `/ws` | Sin límite HTTP de solicitudes mientras el socket permanece abierto | Lectura y escritura `1 h` |

#### `POST /auth/login`
Autentica una cuenta semilla del emulador de identidad. La contraseña se compara en el emulador y nunca se envía a los microservicios de negocio.
- **Disponibilidad:** solo entorno local/de desarrollo; responde `404 RUTA_NO_ENCONTRADA` si `NODE_ENV=production`.
- **Cuerpo:** `{"usuario":"ana","contrasena":"ViajesDemo2026!"}`. Acepta también `{"email":"ana@viajes.local","contrasena":"ViajesDemo2026!"}`.
- **Cuentas locales de demostración:** `ana`, `carlos`, `lucia` y `martin`; contraseña predeterminada `ViajesDemo2026!`. Puede cambiarse con `AUTH_DEMO_PASSWORD`.
- **Respuesta (`200 OK`):** `{"token":"<JWT RS256>","perfil":{"id_usuario":"...","usuario":"ana","email":"ana@viajes.local","nombre":"Ana Gómez","rol":"pasajero"},"expira_en_segundos":3600}`. El token contiene `sub`, `rol`, `iss`, `aud`, `exp`, `name` y `email` y se valida mediante el JWKS del emulador. La respuesta lleva `Cache-Control: no-store`.
- **Credenciales incorrectas (`401`):** `CREDENCIALES_INVALIDAS`, con el mismo mensaje para usuario inexistente o contraseña incorrecta.
- **Cuerpo inválido (`400`):** `ENTRADA_INVALIDA`; cuerpo mayor a `10kb` devuelve `413 PAYLOAD_DEMASIADO_GRANDE`.
- Las cuentas y clave predeterminadas son datos ficticios para la demostración local, no una identidad ni una contraseña para producción.

### Canal de tiempo real

`GET /tiempo-real` (y su alias compatible `GET /ws` utilizado por el cliente web) establece una conexión WebSocket con `ms-viajes` (Nginx reenvía el upgrade en ambos endpoints). El handshake requiere un JWT válido en `Authorization: Bearer <JWT>`. Los clientes de navegador, que no permiten encabezados personalizados en WebSocket, pueden presentar los subprotocolos `viajes.v1`, `autenticacion-jwt`, `<JWT>`; el servidor negocia únicamente `viajes.v1`, nunca devuelve el token. No se aceptan JWT en la URL. El servidor asocia la conexión al `id_usuario` del JWT y no permite elegir otro usuario o viaje en la URL.

Los mensajes son JSON con la envoltura `{"evento":"...","datos":{...}}`:

- `CANAL_LISTO`: confirma que el usuario autenticado quedó conectado.
- `OFERTA_NUEVA`: se entrega únicamente al chofer destinatario. `datos` incluye `id_oferta`, `id_viaje`, `estado`, `enviada_en`, `expira_en`, `origen`, `destino`, `precio_estimado` y `moneda`. El origen, destino y precio corresponden al viaje confirmado y se envían como snapshot; no se recalculan al entregar la oferta.
- `OFERTA_VENCIDA`: se entrega al chofer cuando el servidor observa el vencimiento (al consultar o aceptar); incluye `id_oferta`, `id_viaje`, `estado`, `motivo` y `actualizado_en`. El cliente usa `expira_en` para marcar el vencimiento local en el instante indicado y consulta el GET al reconectar.
- `OFERTA_CANCELADA`: se entrega a los choferes con ofertas pendientes cuando el viaje se asigna a otro chofer o se cancela. Incluye `id_oferta`, `id_viaje`, `estado`, `motivo` y `actualizado_en`.
- `ESTADO_VIAJE_ACTUALIZADO`: se entrega al pasajero y al chofer asignado. `datos` incluye `id_viaje`, `estado`, `id_chofer` y `actualizado_en`.
- `UBICACION_CHOFER_ACTUALIZADA`: se entrega al pasajero del viaje activo. Incluye `id_viaje`, `latitud`, `longitud` redondeadas a tres decimales y `actualizado_en`; no expone la posición precisa almacenada por Flota.

El canal no conserva eventos ni reemplaza la API de consulta. Después de conectar o reconectar, el cliente restaura el estado real con `GET /viajes/:idViaje` o `GET /choferes/yo/ofertas` usando el mismo JWT y luego aplica los mensajes nuevos. El GET de ofertas materializa y notifica los vencimientos que observa. Si el token es inválido, el handshake termina con `401`. La notificación es de mejor esfuerzo y no cambia el resultado de una operación ya persistida.

Ruta interna entre servicios, bloqueada por Nginx desde el exterior:

#### `POST /interno/viajes/ubicacion-chofer`

`ms-flota` llama esta ruta con el JWT original del chofer (o administrador operando como chofer) y la ubicación ya persistida. `ms-viajes` valida el rol, busca la asignación activa del chofer y solo si el viaje está `CHOFER_EN_CAMINO` o `EN_CURSO` emite al pasajero la ubicación aproximada (`202`). Sin viaje en seguimiento devuelve `204`; otros roles reciben `403`. Una falla de esta notificación no revierte la actualización en Flota.

---

## 3. Catálogo de Endpoints Públicos (API Gateway :8080)

### 3.1 Servicio `ms-tarifas` (Estimación y Precios)

#### `POST /viajes/estimacion`
Calcula la tarifa estimada con multiplicador dinámico por demanda, distancia, duración, lluvia y franja horaria.
- **Autorización:** Requiere rol `PASAJERO` o `ADMINISTRADOR`.
- **Cuerpo recibido:**
  ```json
  {
    "origen": { "latitud": -27.451, "longitud": -58.986, "direccion": "Pasaje Julio Acosta 3161, Resistencia" },
    "destino": { "latitud": -27.462, "longitud": -58.993, "direccion": "Shopping Sarmiento" }
  }
  ```
  También admite puntos enviados solo como `{"direccion": "Av. Alberdi 250, Resistencia"}`. Cuando se envían coordenadas y dirección, el servicio conserva el texto junto a las coordenadas; la dirección no cambia el cálculo de ruta ni la tarifa.
  *Modo desarrollador (`DEV-001`):* Cuando `MODO_DESARROLLADOR=true` y `NODE_ENV !== "production"`, admite un objeto opcional `"simulacion": { "hora": 21, "llueve": true, "choferes_disponibles": 2, "solicitudes_activas": 8 }` para simular escenarios sin alterar la regla activa. Si se envía fuera de modo desarrollador o en producción, responde `403 MODO_DESARROLLADOR_DESHABILITADO`.
- **Respuesta exitosa (`201 Created`):**
  ```json
  {
    "id_estimacion": "uuid-estimacion",
    "precio_estimado": "3700",
    "moneda": "ARS",
    "distancia_metros": 2500,
    "duracion_segundos": 300,
    "proveedor_ruta": "OSRM",
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
    "recomendaciones": ["Tarifa estable en este momento."],
    "version_regla": 1,
    "creada_en": "2026-11-02T13:00:00.000Z",
    "vigente_hasta": "2026-11-02T13:03:00.000Z",
    "origen": { "latitud": -27.451, "longitud": -58.986, "direccion": "Pasaje Julio Acosta 3161, Resistencia" },
    "destino": { "latitud": -27.462, "longitud": -58.993, "direccion": "Shopping Sarmiento" },
    "polilinea": "encoded_polyline_o_null"
  }
  ```

#### `GET /reglas/demanda`
Devuelve la regla dinámica vigente y el historial completo de versiones inmutables con autor y fecha de creación.
- **Autorización:** Exclusivo del rol `ADMINISTRADOR` (`SOPORTE`, `PASAJERO` y `CHOFER` reciben `403 ROL_NO_AUTORIZADO`).
- **Respuesta (`200 OK`):**
  ```json
  {
    "activa": {
      "version": 1,
      "autor": "sistema",
      "creada_en": "2026-11-02T13:00:00.000Z",
      "activa": true,
      "tarifa_base_pesos": "1000",
      "precio_por_kilometro_pesos": "600",
      "precio_por_minuto_pesos": "120",
      "multiplicador_minimo": 0.75,
      "multiplicador_maximo": 2.0,
      "lluvia_con_precipitacion": 1.1,
      "lluvia_sin_precipitacion": 1.0,
      "disponibilidad": [
        { "hasta": 0, "multiplicador": 1.3 },
        { "hasta": null, "multiplicador": 1.0 }
      ],
      "demanda_por_mil": [
        { "hasta": 999, "multiplicador": 1.0 },
        { "hasta": null, "multiplicador": 1.3 }
      ],
      "horario": {
        "MADRUGADA": 1.0,
        "MANANA": 1.0,
        "SIESTA": 0.95,
        "TARDE": 1.05,
        "NOCHE": 1.1
      }
    },
    "historial": [ ... ]
  }
  ```

#### `PUT /reglas/demanda`
Valida la curva de demanda y los multiplicadores, y crea una nueva versión activa sin modificar estimaciones ni viajes confirmados previos. El servidor asigna `version` incremental, `autor` desde el JWT validado y `creada_en` con reloj del servidor; el cliente no puede enviar `autor`, `version`, `creada_en` ni campos de precio.
- **Autorización:** Exclusivo del rol `ADMINISTRADOR` (`403 ROL_NO_AUTORIZADO` para otros roles).
- **Cuerpo recibido:** Campos editables de factores dinámicos (`multiplicador_minimo`, `multiplicador_maximo`, `lluvia_con_precipitacion`, `lluvia_sin_precipitacion`, `disponibilidad`, `demanda_por_mil`, `horario`), con multiplicadores entre `0.5` y `5.0` (máximo 4 decimales), límites coherentes (`minimo <= maximo`), umbrales estrictamente crecientes terminados en `hasta: null` y curva de demanda no decreciente.
- **Respuesta (`200 OK`):** `{ "activa": { ... }, "historial": [ ... ] }`.
- **Entrada inválida (`400` / `422`):** `400 ENTRADA_INVALIDA` si incluye campos no permitidos (`autor`, `version`, `creada_en`, `precio`, etc.) o tipos erróneos; `422 REGLA_INVALIDA` si la curva o los límites no son válidos.

#### `POST /tarifas/geocodificacion-inversa`
Convierte coordenadas seleccionadas manualmente en el mapa a una dirección legible usando el geocodificador configurado (`Nominatim`, `Google` o semilla de desarrollo).
- **Autorización:** Requiere rol `PASAJERO` o `ADMINISTRADOR`.
- **Cuerpo recibido:** `{"latitud": -27.45213, "longitud": -58.98738}`.
- **Respuesta (`200 OK`):** `{"direccion": "Juan B. Justo 4, Resistencia", "coordenada": {"latitud": -27.45213, "longitud": -58.98738}}`.

---

### 3.2 Servicio `ms-viajes` (Ciclo de Vida del Viaje y Ofertas)

#### `POST /viajes`
Confirma la solicitud de un viaje a partir de una estimación vigente. Congela el precio y los factores de auditoría de forma inmutable.
- **Autorización:** Requiere rol `PASAJERO` o `ADMINISTRADOR`.
- **Encabezados:** `Clave-Idempotencia: <string>`.
- **Cuerpo recibido:** `{"id_estimacion": "uuid-estimacion"}`.
- **Respuesta (`201 Created`):** Objeto Viaje en estado `"solicitado"` si se encontraron candidatos o `"sin_choferes_disponibles"` si la búsqueda no encontró ninguno.

#### `GET /viajes`
Pasajero y chofer reciben sus viajes propios. `SOPORTE` y `ADMINISTRADOR` pueden consultar el listado global con filtros y paginación.
- **Filtros opcionales (solo operador/admin):** `estado` (estado público en minúsculas), `desde` (fecha ISO 8601 UTC inclusiva), `hasta` (fecha ISO 8601 UTC exclusiva), `pagina` (desde 1) y `limite` (1–100; predeterminado 20).
- **Respuesta operador/admin (`200 OK`):** `{"viajes": [ ... ], "pagina": 1, "limite": 20, "total": 42}`.
- **Respuesta pasajero/chofer (`200 OK`):** `{"viajes": [ ... ]}` con sus viajes; si envía filtros, recibe `403 ROL_NO_AUTORIZADO`.
- **Entrada inválida (`400`):** estado, fecha, página, límite o combinación de fechas inválida.

#### `GET /viajes/:idViaje/auditoria-tarifa`
Devuelve el snapshot de precio que quedó congelado al confirmar el viaje. No vuelve a calcular la tarifa.
- **Autorización:** Solo `SOPORTE` o `ADMINISTRADOR`.
- **Respuesta (`200 OK`):** `{"id_viaje": "...", "id_estimacion": "...", "precio_confirmado": "125000", "moneda": "ARS", "multiplicador_demanda": 1.25, "factores_precio": { ... }, "version_regla": 1, "congelada_en": "2026-11-17T15:04:05.000Z"}`.
- **No encontrado (`404`):** `VIAJE_NO_ENCONTRADO`.
- **No autorizado (`403`):** `ROL_NO_AUTORIZADO`.

#### `GET /viajes/:idViaje`
Consulta el detalle de un viaje específico.
- **Autorización:** Solo el pasajero creador, el chofer asignado, `SOPORTE` o `ADMINISTRADOR`.
- **Respuesta (`200 OK`):** Objeto Viaje detallado. Si no pertenece al actor $\rightarrow$ `403 VIAJE_NO_AUTORIZADO`.

#### `POST /viajes/:idViaje/cancelacion`
Cancela un viaje según las transiciones y permisos definidos en `docs/modelo.md`.
- **Cuerpo:** `{"motivo": "string opcional"}`.
- **Autorización:** pasajero titular desde `SOLICITADO`, `ASIGNADO` o `CHOFER_EN_CAMINO`; chofer asignado desde `ASIGNADO` o `CHOFER_EN_CAMINO`; `SOPORTE` o `ADMINISTRADOR` desde cualquier estado activo.
- **Respuesta (`200 OK`):** Viaje en uno de los estados `cancelado_por_pasajero`, `cancelado_por_chofer` o `cancelado_por_operador`.
- **Conflicto (`409`):** `TRANSICION_ESTADO_INVALIDA` si el estado actual no admite la cancelación.

#### `POST /viajes/:idViaje/llegada`
El chofer asignado marca su llegada al punto de encuentro.
- **Autorización:** Exclusivo del `CHOFER` asignado (o `ADMINISTRADOR` asignado). Transiciona de `ASIGNADO` a `CHOFER_EN_CAMINO`.
- **Respuesta (`200 OK`):** Viaje en estado `"chofer_en_camino"`.

#### `POST /viajes/:idViaje/inicio`
El chofer inicia el recorrido con el pasajero a bordo.
- **Autorización:** Exclusivo del `CHOFER` asignado (o `ADMINISTRADOR` asignado). Transiciona a `EN_CURSO`.
- **Respuesta (`200 OK`):** Viaje en estado `"en_curso"`.

#### `POST /viajes/:idViaje/finalizacion`
El chofer finaliza el viaje, fijando el precio final y generando el cobro único.
- **Autorización:** Exclusivo del `CHOFER` asignado (o `ADMINISTRADOR` asignado). Transiciona a `FINALIZADO`.
- **Respuesta (`200 OK`):** `{ "viaje": { ... }, "cobro": { "id_cobro": "...", "id_viaje": "...", "importe": "8086", "moneda": "ARS", "estado": "fallido", "intentos": 1, "creado_en": "2026-11-18T12:00:00.000Z" } }`.
- El adaptador falso devuelve un primer fallo reproducible (`fallido`) y permite demostrar luego un reintento exitoso. El viaje queda `finalizado` y el importe del cobro coincide con `precio_final`.

#### `GET /viajes/:idViaje/cobro`
Consulta el recibo asociado al viaje sin volver a procesar el pago.
- **Autorización:** Pasajero titular, chofer asignado, `SOPORTE` o `ADMINISTRADOR`.
- **Respuesta (`200 OK`):** `{ "id_cobro": "...", "id_viaje": "...", "importe": "8086", "moneda": "ARS", "estado": "fallido", "intentos": 1, "creado_en": "2026-11-18T12:00:00.000Z" }`.
- **No encontrado (`404`):** `VIAJE_NO_ENCONTRADO` si el viaje no existe; `COBRO_NO_ENCONTRADO` si todavía no generó un cobro.
- **No autorizado (`403`):** `COBRO_NO_AUTORIZADO` para otros usuarios.

#### `POST /viajes/:idViaje/cobro/reintento`
Reintenta un cobro fallido del viaje finalizado.
- **Autorización:** Pasajero titular, `SOPORTE` o `ADMINISTRADOR`. El chofer puede consultar el recibo, pero no iniciar un nuevo intento de pago.
- **Encabezados:** `Clave-Idempotencia: <string>` obligatorio.
- **Cuerpo:** vacío (`{}` también es válido).
- **Respuesta (`200 OK`):** objeto Cobro actualizado. Si se repite la misma clave, se devuelve el resultado de ese intento; no se procesa otro pago.
- Un cobro `confirmado` se devuelve sin ejecutar un nuevo intento. Un cobro pendiente no se puede reintentar (`409 COBRO_NO_REINTENTABLE`).
- **Entrada inválida (`400`):** falta `Clave-Idempotencia`.
- **Conflicto (`409`):** `COBRO_NO_REINTENTABLE` cuando el cobro todavía no está fallido o el viaje no está finalizado.

#### `GET /choferes/yo/ofertas`
Lista las ofertas vigentes enviadas al chofer autenticado.
- **Autorización:** Exclusivo del rol `CHOFER` o `ADMINISTRADOR`.
- **Respuesta (`200 OK`):** `{"ofertas": [{"id_oferta": "...", "id_viaje": "...", "id_chofer": "...", "estado": "pendiente", "enviada_en": "...", "expira_en": "...", "origen": {"latitud": -27.451, "longitud": -58.986, "direccion": "Pasaje Julio Acosta 3161, Resistencia"}, "destino": {"latitud": -27.462, "longitud": -58.993, "direccion": "Shopping Sarmiento"}, "precio_estimado": "3700", "moneda": "ARS"}]}`. `origen`, `destino` y `precio_estimado` se leen del viaje confirmado asociado a esa oferta; incluyen las direcciones que envió el pasajero cuando las informó, y el precio es el snapshot exacto representado como cadena decimal.
- **Alcance:** Solo incluye ofertas dirigidas al chofer autenticado. El chofer candidato no consulta directamente `GET /viajes/:idViaje` antes de aceptar.

#### `POST /choferes/yo/ofertas/:idOferta/aceptacion`
El chofer acepta una oferta de viaje antes de su vencimiento (60 segundos).
- **Autorización:** Exclusivo del `CHOFER` (o `ADMINISTRADOR`) destinatario de la oferta.
- **Respuesta (`200 OK`):** Objeto Viaje transicionado a `ASIGNADO`.

#### `POST /choferes/yo/ofertas/:idOferta/rechazo`
El chofer rechaza la oferta explícitamente.
- **Respuesta (`200 OK`):** Objeto Oferta en estado `"rechazada"`.

---

### 3.3 Servicio `ms-flota` (Choferes y Ubicaciones)

#### `PATCH /choferes/yo/disponibilidad`
Cambia el estado de disponibilidad del chofer autenticado.
- **Autorización:** Exclusivo de rol `CHOFER` habilitado o `ADMINISTRADOR`.
- **Cuerpo:** `{"disponibilidad": true}` o `{"disponibilidad": false}`.
- **Respuesta (`200 OK`):** Datos del chofer con nueva disponibilidad.

#### `POST /choferes/yo/ubicacion`
Registra la posición GPS actual del chofer.
- **Autorización:** Exclusivo de rol `CHOFER` habilitado o `ADMINISTRADOR`.
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
| **`403`** | Forbidden | `COBRO_NO_AUTORIZADO` | El actor no es el pasajero titular, chofer asignado ni soporte del viaje. |
| **`404`** | Not Found | `VIAJE_NO_ENCONTRADO` | El identificador de viaje no existe en el sistema. |
| **`404`** | Not Found | `COBRO_NO_ENCONTRADO` | El viaje existe, pero todavía no tiene un cobro generado. |
| **`404`** | Not Found | `OFERTA_NO_ENCONTRADA` | La oferta solicitada no existe. |
| **`404`** | Not Found | `CHOFER_NO_ENCONTRADO` | El chofer no está registrado. |
| **`404`** | Not Found | `ESTIMACION_NO_ENCONTRADA` | La estimación solicitada no existe. |
| **`404`** | Not Found | `DIRECCION_NO_ENCONTRADA` | El geocodificador no halló resultados para el texto. |
| **`404`** | Not Found | `RUTA_NO_ENCONTRADA` | Ruta inexistente o interceptada como ruta interna en Gateway. |
| **`409`** | Conflict | `ESTIMACION_VENCIDA` | Se intentó confirmar un viaje tras superar los 3 minutos de vigencia. |
| **`409`** | Conflict | `OFERTA_VENCIDA` / `OFERTA_NO_DISPONIBLE` | La oferta superó los 60s o ya fue respondida. |
| **`409`** | Conflict | `ASIGNACION_EN_CONFLICTO` | Carrera concurrente: otro chofer ganó la asignación o el chofer ya tiene viaje activo. |
| **`409`** | Conflict | `CHOFER_NO_HABILITADO` | Chofer con carnet no validado o inhabilitado administrativamente. |
| **`409`** | Conflict | `TRANSICION_ESTADO_INVALIDA` | Transición no permitida por la máquina de estados o intento de cambiar un estado terminal. |
| **`409`** | Conflict | `COBRO_NO_REINTENTABLE` | El viaje no finalizó o el cobro no está en estado `fallido`. |
| **`413`** | Payload Too Large | `PAYLOAD_DEMASIADO_GRANDE` | El cuerpo supera el límite configurado (16 KB en Gateway, 10–20 KB en servicios). |
| **`422`** | Unprocessable Entity | `IMPORTE_INVALIDO` / `REGLA_INVALIDA` | Parámetros matemáticos o de regla fuera de rango permitido. |
| **`422`** | Unprocessable Entity | `ZONA_NO_ENCONTRADA` | Coordenadas fuera de cobertura de las zonas tarifarias activas. |
| **`429`** | Too Many Requests | `DEMASIADAS_SOLICITUDES` | Superación del límite razonable de tasa (`rate limiting`) en Gateway Nginx. |
| **`503`** | Service Unavailable | `DEPENDENCIA_NO_DISPONIBLE` | Falla o timeout al consultar PostgreSQL, OSRM, Google Routes, Open-Meteo o microservicio hermano. |
| **`500`** | Internal Server Error | `ERROR_INTERNO` | Error imprevisto en la ejecución del servidor. |
