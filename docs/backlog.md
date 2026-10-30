# Backlog inicial

Estados permitidos: `pendiente`, `en progreso`, `bloqueado`, `en revisión`, `terminado`.

## Asignación de flujos de trabajo

Para permitir el trabajo simultáneo sin colisiones, el trabajo se divide en:
- **Flujo A (Núcleo de Viajes, Persistencia y Concurrencia)**: persistencia de viajes en PostgreSQL, transacciones de asignación, idempotencia y carreras concurrentes.
- **Flujo B (Flota, Tarea Pesada, Búsqueda Geo y Tiempo Real)**: simulador de carga de 500 choferes, optimización de cercanía, WebSockets (Tema 20) y mediciones.
- **Flujo C (Seguridad, Observabilidad, Google Maps y Operación)**: Firebase Emulator (Tema 19), OpenTelemetry y Jaeger (Tema 18), Google Maps Routes y Geocoding, Nginx y Docker Compose.
- **Común**: tareas transversales compartidas o ya cerradas.

| ID | Trabajo | Prioridad | Estado | Flujo | Criterio de aceptación |
|---|---|---:|---|---|---|
| MVP-001 | Definir el recorrido mínimo demostrable | Alta | terminado | Común | `docs/alcance-minimo.md` describe el flujo, los endpoints, los soportes necesarios y el criterio de aceptación sin reducir requisitos del enunciado. |
| DOM-001 | Documentar variante A: precio dinámico por demanda | Alta | terminado | Común | La variante está registrada en AGENTS, modelo, API y backlog. |
| DOM-003 | Definir regla configurable de precio dinámico | Alta | en revisión | Flujo C | ADR 0021 documenta una regla inicial configurable por versión, importes exactos y límites; requiere validación del equipo. |
| DOM-004 | Congelar precio al confirmar | Alta | en progreso | Flujo A | Dominio de viajes ya congela importe y factores; falta integración HTTP y persistente con tarifas. |
| DOM-005 | Resolver carrera entre recálculo y confirmación | Alta | pendiente | Flujo A | Un test concurrente demuestra que nunca se confirma un precio distinto al aceptado. |
| DOM-006 | Registrar evidencia de cálculo dinámico | Alta | en progreso | Flujo A | Tarifas guarda un snapshot auditable; falta persistirlo junto al viaje confirmado. |
| DOM-007 | Elegir fuente del dato de lluvia | Alta | en revisión | Flujo C | ADR 0008 acepta Open-Meteo para el prototipo académico; el adaptador aplica caché y rechaza observaciones vencidas. |
| DOM-002 | Cerrar estados y transiciones del viaje | Alta | en progreso | Flujo A | Cada transición válida e inválida está documentada y testeada. |
| ARC-001 | Completar ADR de módulos | Alta | en progreso | Común | La decisión CommonJS/ESM queda aceptada y reproducida desde clon limpio. |
| ARC-002 | Completar ADR de persistencia | Alta | en progreso | Flujo A | PostgreSQL y estrategia de acceso a datos tienen alternativas y consecuencias. |
| ARC-003 | Elegir mecanismo de asignación concurrente | Alta | pendiente | Flujo A | Cincuenta aceptaciones concurrentes dejan exactamente un ganador. |
| ARC-004 | Elegir geolocalización | Alta | pendiente | Flujo B | Se comparan al menos dos opciones y se define política de retención. |
| ARC-005 | Elegir canal de tiempo real | Media | pendiente | Flujo B | El canal y la recuperación tras reconexión están documentados. |
| API-001 | Consolidar contrato HTTP | Alta | pendiente | Flujo C | Endpoints, códigos, errores, autenticación e idempotencia están definidos. |
| SEC-001 | Diseñar autorización por recurso | Alta | pendiente | Flujo C | Hay pruebas de acceso permitido y denegado para viajes y ubicaciones. |
| CON-001 | Definir caso de cancelación simultánea | Alta | pendiente | Flujo A | El resultado de carrera está especificado y testeado. |
| MED-001 | Diseñar simulador de 500 choferes | Media | pendiente | Flujo B | Se puede ejecutar carga sostenida y medir p50, p95, p99, lag y memoria. |
| OPS-001 | Definir arranque, readiness y apagado | Alta | pendiente | Flujo C | La secuencia de clon limpio queda documentada y verificable. |
| ARC-006 | Definir limites de microservicios y autenticacion externa | Alta | en progreso | Común | ADR 0016 y contratos compartidos documentan servicios, actor JWT y dependencias. |
| VIA-001 | Implementar dominio inicial de ms-viajes | Alta | en progreso | Flujo A | Estados, confirmacion, ofertas, asignacion, cancelacion, finalizacion y cobro tienen puertos y tests. |
| MVP-002 | Implementar demo de viaje por terminal | Alta | terminado | Común | Un pasajero o chofer elige rol, informa destino, confirma tarifa, inicia y finaliza un viaje con datos persistidos en memoria y precio final visible. Implementado en `src/viaje.ts` y `src/terminal.ts`, con tests en `src/viaje.test.ts`. |
| MVP-003 | Calcular tarifa con rutas reales | Alta | terminado | Común | La demo usa un proveedor configurable de rutas por calles y calcula el precio con distancia y duración reales; incluye Google Routes API, OSRM y fallback Haversine. |
| MVP-004 | Mostrar recorrido y estimación en una demo web | Baja | terminado | Común | Una página local permite ingresar origen y destino, muestra la ruta, distancia, duración, precio orientativo en ARS y vigencia usando el caso de uso de estimación existente, y simula los estados del viaje sin persistirlo. |
| FLOT-001 | Implementar dominio inicial de ms-flota | Alta | terminado | Flujo B | Disponibilidad, ubicación, candidatos, ocupación y autorización tienen puertos y tests en memoria. |
| FLOT-002 | Integrar adaptador PostgreSQL y esquema inicial | Alta | terminado | Flujo B | PostgreSQL se compone en `ms-flota`, persiste disponibilidad y ubicación actual, aplica actualización condicional y expone readiness con `SELECT 1`. |
| FLOT-003 | Publicar endpoints iniciales de ms-flota | Alta | terminado | Flujo B | Las cuatro rutas están documentadas y protegidas por JWT externo o por el proveedor falso explícito de desarrollo. |
| TAR-001 | Implementar dominio de `ms-tarifas` | Alta | en progreso | Flujo C | Dominio y pruebas cubren fórmula inicial, factores, BigInt, auditoría y vigencia; falta validar política y conectar extremos. |
| TAR-002 | Adaptadores de `ms-tarifas` | Alta | en progreso | Flujo C | Existen adaptadores OSRM/Google/Haversine, clima y PostgreSQL; falta ejecutar integración con servicios reales y Compose. |
| INT-001 | Integrar tarifas, viajes y flota por HTTP | Alta | en progreso | Común | Estimación, demanda, candidatos y ocupación se consultan entre servicios con JWT propagado, timeout, reintento GET limitado y error seguro; falta persistencia y asignación atómica distribuida de viajes. |
| INT-002 | Persistir viajes, ofertas, cobros e idempotencia en PostgreSQL | Alta | pendiente | Flujo A | Los casos HTTP usan repositorios PostgreSQL y transacciones que preservan idempotencia y una sola asignación por viaje/chofer entre instancias. |
| OPS-002 | Completar gateway, JWT y Compose | Alta | terminado | Flujo C | Compose arranca PostgreSQL, los tres procesos y Nginx con healthchecks, DNS interno y proveedores controlados para E2E. |
| OPS-003 | Ejecutar flujo E2E reproducible | Alta | terminado | Común | `npm run test:e2e` y `requests/flujo-e2e.http` cubren estimación, confirmación, ofertas, asignación, estados y cobro. |
| VIA-002 | Publicar API HTTP de ms-viajes | Alta | terminado | Flujo A | Router Express delgado, JWT por puerto, DTOs, errores uniformes, idempotencia y tests HTTP. |
| TIE-001 | WebSockets y tiempo real (Tema 20) | Alta | pendiente | Flujo B | Canal bidireccional para notificación de ofertas al chofer y seguimiento de viaje al pasajero con reconexión demostrable. |
| OBS-001 | Observabilidad con OpenTelemetry y Jaeger (Tema 18) | Alta | en progreso | Flujo C | ADR 0050 aceptado. SDK OpenTelemetry en servicios, propagación de trace_id en headers y logs JSON, y visualización de traza distribuida con error en Jaeger. |
| SEG-002 | Firebase Emulator Suite y RBAC (Tema 19) | Alta | pendiente | Flujo C | Contenedor de Firebase Emulator en Compose, validación JWKS con roles en claims, y comparación de token válido, vencido y sin permiso. |
| GEO-001 | Google Maps Rutas y Geocodificación | Media | pendiente | Flujo C | Geocoding para aceptar direcciones textuales, Routes API para distancias/duración reales y fallback offline Haversine para tests. |

## Regla de actualización

Cada tarea debe tener un único estado visible y enlazar, cuando exista, al documento, ADR, test o pull request que demuestra su avance.
