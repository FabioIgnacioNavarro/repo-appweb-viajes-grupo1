# Elección y Justificación de Temas Especiales de Cátedra

Este documento registra los temas especiales seleccionados por el grupo para su implementación y demostración en el backend de la plataforma de viajes, así como la justificación técnica de aquellos descartados.

---

## 1. Temas Seleccionados

### Tema 20 — Tiempo Real: WebSockets y actualización en tiempo real
* **Pregunta guía:** ¿Cuándo conviene mantener una conexión persistente en lugar de consultar periódicamente?
* **Justificación en el proyecto:**
  * En una aplicación de viajes tipo Uber, el ciclo de vida del viaje involucra eventos efímeros y críticos en tiempo:
    1. **Notificación de ofertas al chofer:** Las ofertas tienen un vencimiento estricto de 60 segundos. Si 500 choferes consultan continuamente vía *HTTP polling* cada 2 segundos (`GET /choferes/yo/ofertas`), se generan miles de solicitudes vacías por segundo que degradan el gateway y la base de datos sin aportar valor.
    2. **Seguimiento del viaje para el pasajero:** Permite recibir la actualización de estado (`ASIGNADO`, `CHOFER_EN_CAMINO`, `EN_CURSO`, `FINALIZADO`) y la posición aproximada del chofer en camino sin reconsultar el endpoint de viaje.
  * Mantener una conexión persistente (WebSocket) es óptimo cuando la frecuencia de eventos es impredecible, bidireccional y se requiere entrega inmediata con bajo overhead de encabezados HTTP.
* **Demostración práctica planificada:**
  * Dos clientes conectados (un pasajero y un chofer) reciben al instante los eventos emitidos por el backend.
  * Simulación de desconexión y reconexión básica, demostrando cómo el cliente recupera el estado de verdad mediante una consulta `GET` y restablece el canal en tiempo real.

---

### Tema 18 — Observabilidad: Logs estructurados, métricas y trazas distribuidas
* **Pregunta guía:** ¿Cómo seguir una solicitud que atraviesa varios servicios?
* **Justificación en el proyecto:**
  * El backend está estructurado en tres microservicios (`ms-viajes`, `ms-tarifas`, `ms-flota`) orquestados a través de un gateway Nginx.
  * Un flujo común (por ejemplo, confirmar un viaje o calcular una tarifa dinámica) cruza fronteras de red: el gateway recibe el pedido, invoca a `ms-viajes`, este consulta a `ms-flota` para obtener candidatos y a `ms-tarifas` para la regla de precio.
  * Si un servicio falla o responde con lentitud (latencia alta o error `503 DEPENDENCIA_NO_DISPONIBLE`), revisar logs aislados en archivos de texto independientes vuelve casi imposible diagnosticar la causa raíz.
  * La incorporación de OpenTelemetry SDK junto con Jaeger permite inyectar y propagar encabezados de contexto W3C (`traceparent` y `trace_id`), correlacionando cada llamada HTTP, query SQL y evento en una misma traza visual.
* **Demostración práctica planificada:**
  * Ejecutar una solicitud que atraviese el gateway y al menos dos servicios.
  * Visualizar en la UI de Jaeger la traza distribuida desglosada por spans con sus tiempos individuales de ejecución.
  * Forzar un error (o timeout controlado) en una dependencia interna y demostrar cómo la traza en Jaeger identifica de inmediato el servicio y la operación que falló.

---

### Tema 19 — Seguridad: OAuth 2.0 / OIDC, JWT y autorización entre servicios
* **Pregunta guía:** ¿Cómo autenticar al usuario y autorizar cada recurso sin confiar sólo en la interfaz?
* **Justificación en el proyecto:**
  * Siguiendo el principio de arquitectura hexagonal y la regla 4 de `AGENTS.md`, los microservicios no gestionan contraseñas ni implementan pantallas de login; delegan la identidad en un proveedor externo (OIDC / Firebase Auth) mediante tokens JWT validados localmente vía JWKS.
  * **Autorización por recurso:** Un token válido no garantiza acceso irrestricto. El backend debe verificar que un pasajero solo pueda consultar sus propios viajes, que un chofer solo pueda aceptar ofertas expresamente dirigidas a su ID de usuario, y que las rutas internas de coordinación (`/interno/*`) queden vedadas a usuarios directos y accesibles únicamente entre servicios autorizados.
  * Responde directamente al requerimiento de resistir ataques cruzados controlados (`docs/ataque.md`).
* **Demostración práctica planificada:**
  * Obtención de credenciales de prueba desde un emulador OIDC / Firebase Emulator local.
  * Comparación en vivo de tres escenarios HTTP:
    1. **Acceso autorizado (200/201):** Actor con rol y permisos correctos sobre el recurso.
    2. **Token vencido / manipulado (401 Unauthorized):** Rechazo de la firma o expiración del JWT sin consultar la base de datos.
    3. **Usuario sin permiso (403 Forbidden):** Token legítimo pero intentando operar un viaje o ubicación que pertenece a otro usuario (violación de autorización por recurso).

---

## 2. Tema Descartado y Justificación Técnica

### Tema 1 — Datos y caché: Redis: caché y datos efímeros
* **Pregunta guía de la cátedra:** ¿Qué datos conviene mantener en memoria y cómo evitar información obsoleta?
* **Por qué NO lo elegimos en este proyecto:**
  1. **Evitar dos fuentes de verdad y fallas de consistencia (ADR 0026):**
     * El núcleo de la plataforma de viajes es fuertemente transaccional: la invariante de negocio establece que un viaje activo tiene exactamente un chofer y un chofer no puede tener dos viajes activos en simultáneo.
     * Incorporar una caché de lectura/escritura con Redis introduce el problema de *cache invalidation* y el riesgo de carreras donde una réplica lea datos obsoletos de Redis mientras PostgreSQL ya confirmó una asignación.
  2. **Naturaleza altamente mutable y efímera de los datos:**
     * En una flota de transporte, las coordenadas de los choferes cambian cada 2 segundos y los estados de los viajes avanzan en segundos (`SOLICITADO` -> `ASIGNADO` -> `CHOFER_EN_CAMINO`). La tasa de aciertos (*cache hit*) para datos reutilizables es baja, y el costo de invalidación constante superaría los beneficios.
  3. **Principio de no agregar infraestructura prematura (Regla 9 de `AGENTS.md`):**
     * PostgreSQL con índices adecuados (ej. índices parciales sobre choferes disponibles y viajes activos) y estructuras en memoria en los procesos de dominio resuelve la latencia requerida sin sumar la complejidad operativa de un clúster de Redis en Docker Compose.
  4. **Mayor retorno académico y arquitectónico en los otros temas:**
     * Los desafíos centrales de la materia (concurrencia, microservicios, seguridad y carga masiva) se demuestran de manera mucho más contundente a través de **Observabilidad distribuida (OpenTelemetry)**, **Seguridad por recurso (OIDC/JWT)** y **Tiempo real (WebSockets)**, que aportan un valor superior a la arquitectura del trabajo práctico.
