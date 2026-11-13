# Guía de Demostración — Tema 18: Observabilidad (OpenTelemetry + Jaeger)

Esta guía documenta los pasos reproducibles para ejecutar la demostración práctica del **Tema 18** ante los docentes de la cátedra.

---

## Pregunta Guía
> **¿Cómo seguir una solicitud que atraviesa varios servicios?**
>
> **Respuesta demostrable:** Inyectando y propagando el estándar W3C Trace Context (`traceparent`) en cada salto de red HTTP entre servicios. Toda solicitud entrante genera o propaga un `trace_id` único que correlaciona los spans de ejecución y los logs estructurados, permitiendo visualizar la cascada completa de tiempos y errores en Jaeger.

---

## Requisitos Previos
1. Docker y Docker Compose instalados.
2. Levantar el entorno completo:
   ```powershell
   docker compose up --build -d
   ```
3. Verificar que los servicios y Jaeger estén saludables:
   - Gateway Nginx: [http://localhost:8080/health](http://localhost:8080/health)
   - Jaeger UI: [http://localhost:16686](http://localhost:16686)

---

## Escenario 1: Flujo Exitoso con Traza Distribuida Multi-Servicio

### 1. Ejecutar una solicitud que atraviesa múltiples servicios
Enviar una cotización de viaje (estimación de tarifa dinámica) a través del Gateway:
```powershell
$token = "falso.eyJ0aXBvIjoiand0LWZhbHNvIiwiaWRVc3VhcmlvIjoiMjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyIiwicm9sIjoiUEFTQUpFUk8ifQ"
$body = '{"origen":{"latitud":-27.45,"longitud":-58.98},"destino":{"latitud":-27.46,"longitud":-58.97}}'

Invoke-RestMethod -Uri "http://localhost:8080/viajes/estimacion" -Method Post -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } -Body $body
```

### 2. Visualizar la traza en Jaeger
1. Abrir en el navegador [http://localhost:16686](http://localhost:16686).
2. En el panel izquierdo (**Search**):
   - **Service:** Seleccionar `ms-tarifas`.
   - Clic en **Find Traces**.
3. Seleccionar la traza generada (`POST /viajes/estimacion`).
4. **Qué se observa:**
   - Una traza unificada que cruza **tres servicios diferentes** (`ms-tarifas`, `ms-flota` y `ms-viajes`).
   - La cascada temporal desglosada con la latencia exacta de cada span:
     - Span raíz: `POST /viajes/estimacion` en `ms-tarifas`.
     - Span hijo: `dependencia.ms-flota.candidatos` (llamada HTTP interna a flota).
     - Span en flota: `GET /choferes/cercanos`.
     - Span hijo de flota: consulta de choferes ocupados hacia `ms-viajes`.
     - Span hijo de tarifas: consulta de demanda hacia `ms-viajes`.
   - Cada llamada HTTP saliente propagó el encabezado W3C `traceparent`.

---

## Escenario 2: Captura Visual de un Error Inducido en una Dependencia

### 1. Provocar un fallo cerrando uno de los servicios internos
Detener el servicio `ms-flota` para inducir una falla de dependencia:
```powershell
docker compose stop ms-flota
```

### 2. Reintentar la solicitud
```powershell
Invoke-RestMethod -Uri "http://localhost:8080/viajes/estimacion" -Method Post -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } -Body $body
```
*Respuesta obtenida:* Error HTTP `503` con `{ "error": { "codigo": "DEPENDENCIA_NO_DISPONIBLE", ... } }`.

### 3. Visualizar el error en Jaeger y los Logs Correlacionados
1. Volver a [http://localhost:16686](http://localhost:16686) y buscar las trazas más recientes de `ms-tarifas`.
2. **Qué se observa:**
   - La traza aparece marcada en **color rojo** con la etiqueta `error: true`.
   - Al hacer clic en el span fallido (`dependencia.ms-flota.candidatos`):
     - Se visualiza el log del error: `timeout_o_red` o código HTTP correspondiente.
     - Se evidencia el tiempo exacto que insumió el timeout antes de fallar cerrado.
3. En la terminal, verificar que el log estructurado de la aplicación imprimió el mismo `trace_id`:
   ```powershell
   docker compose logs ms-tarifas --tail 20
   ```
   *Salida evidenciada:* `{"evento":"dependencia_http_fallida","servicio":"ms-flota","resultado":"timeout_o_red","traceId":"...","spanId":"..."}`.

### 4. Restaurar el servicio
```powershell
docker compose start ms-flota
```

---

## Escenario 3: Pruebas de Fallas de Dependencias, Timeout y Recuperación con Idempotencia (FAL-001)

Este escenario complementa las pruebas de resiliencia del sistema demostrando que:
1. Las llamadas entre servicios no se cuelgan indefinidamente (están acotadas por `AbortSignal.timeout` con 1 reintento preventivo).
2. Si un microservicio subordinado cae, el servicio llamador no colapsa ni expone detalles internos de la infraestructura, sino que responde un error uniforme `503 Service Unavailable` con código `DEPENDENCIA_NO_DISPONIBLE`.
3. Al restablecer la dependencia caída, el cliente puede reenviar exactamente la misma petición con la misma `Clave-Idempotencia`: la operación se completa de forma limpia y sucesivas repeticiones devuelven el recurso persistido sin duplicar cobros ni viajes.
4. Las fallas de canales secundarios (como la notificación WebSocket de ubicación a `ms-viajes`) degradan elegantemente sin abortar la persistencia de la ubicación en `ms-flota`.

### 1. Ejecución Automatizada de la Suite de Pruebas (FAL-001)

Para verificar los 5 escenarios de falla y recuperación de forma determinística en memoria:
```powershell
npm run build:server
npm run build:tests
node --test "dist-tests/tests/ms-viajes/fallas-dependencias.test.js"
```

*Casos de prueba cubiertos:*
- `FAL-001: ms-viajes devuelve 503 DEPENDENCIA_NO_DISPONIBLE ante caída de ms-flota durante confirmación`
- `FAL-001: ms-viajes devuelve 503 DEPENDENCIA_NO_DISPONIBLE ante caída de ms-tarifas al verificar estimación`
- `FAL-001: ClienteServiciosHttp acota timeout, reintenta una sola vez y registra evento estructurado seguro`
- `FAL-001: recuperación exitosa y reintento con misma Clave-Idempotencia tras restablecer dependencia`
- `FAL-001: degradación elegante en ms-flota ante fallo o timeout del notificador de viajes en tiempo real`

### 2. Ejecución Manual en Vivo con `requests/fallas.http`

El archivo [`requests/fallas.http`](file:///requests/fallas.http) permite ejecutar y reproducir el ciclo completo desde la extensión REST Client de VS Code o mediante `curl` / `Invoke-RestMethod`:

#### Paso 1: Generar cotización base saludable
Enviar la petición de la **Sección 1** (`POST /viajes/estimacion`).
Registrar el `id_estimacion` devuelto y verificar que la traza en Jaeger es azul/verde (exitosa).

#### Paso 2: Detener ms-flota e inducir error 503
```powershell
docker compose stop ms-flota
```
Ejecutar la petición de la **Sección 2.2** (`POST /viajes/estimacion`) o **2.3** (`POST /viajes` con `Clave-Idempotencia: recuperacion-demo-001`).
- **Respuesta HTTP:** `503 Service Unavailable`
- **Cuerpo JSON uniforme:**
  ```json
  {
    "error": {
      "codigo": "DEPENDENCIA_NO_DISPONIBLE",
      "mensaje": "No se pudo completar la operación por una dependencia temporalmente no disponible.",
      "detalles": {}
    }
  }
  ```
- **Inspección en Jaeger ([http://localhost:16686](http://localhost:16686)):**
  - Buscar trazas del servicio `ms-viajes` o `ms-tarifas`.
  - El span `dependencia.ms-flota.candidatos` aparece en **rojo** con la etiqueta `error: true`.
  - El log estructurado confirma `resultado: "timeout_o_red"`, incluyendo `traceId` y `spanId` pero **omitiendo estrictamente cualquier token JWT o credencial**.

#### Paso 3: Recuperación del servicio y reintento idempotente
```powershell
docker compose start ms-flota
```
Esperar a que la sonda de readiness responda activo:
```powershell
Invoke-RestMethod -Uri "http://localhost:8080/ready/flota" -Method Get
```
Reenviar la solicitud de confirmación con la **misma cabecera**:
`Clave-Idempotencia: recuperacion-demo-001`
- **Primer reintento tras recuperación:** HTTP `201 Created` con el viaje confirmado y ofertas generadas.
- **Segundo reintento con idéntica clave:** HTTP `201 Created` retornando inmediatamente el mismo viaje ya congelado y persistido, demostrando que no se duplica la entidad ni se desincronizan las ofertas.

