# Backlog inicial

Estados permitidos: `pendiente`, `en progreso`, `bloqueado`, `en revisión`, `terminado`.

Sprint activo: [docs/sprint-01.md](sprint-01.md) (3 al 9 de noviembre).

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
| DOM-003 | Definir regla configurable de precio dinámico | Alta | terminado | Flujo C | Closes #13. ADR 0021 aceptado; regla versionada en PostgreSQL (`tarifa.regla_tarifa`), importes exactos en `BigInt` y límites `[0.75, 2.00]` verificados en `dominio.test.ts`. |
| DOM-004 | Congelar precio al confirmar | Alta | terminado | Flujo A | Dominio y schema.sql congelan precio_estimado y factores_precio en PostgreSQL de forma inmutable. |
| DOM-005 | Resolver carrera entre recálculo y confirmación | Alta | pendiente | Flujo A | Un test concurrente demuestra que nunca se confirma un precio distinto al aceptado. |
| DOM-006 | Registrar evidencia de cálculo dinámico | Alta | terminado | Flujo A | factores_precio JSONB persiste en viajes.viaje el snapshot auditable de la estimación confirmada. |
| DOM-007 | Elegir fuente del dato de lluvia | Alta | terminado | Flujo C | Closes #15. ADR 0008 aceptado; adaptador Open-Meteo con caché de 15 min por zona, doble falso y rechazo de observaciones vencidas (`CLIMA_DESACTUALIZADO`). |
| DOM-002 | Cerrar estados y transiciones del viaje | Alta | en progreso | Flujo A | Cada transición válida e inválida está documentada y testeada. |
| ARC-001 | Completar ADR de módulos | Alta | en revisión | Flujo B | ADR 0001 aceptado; documenta convivencia de CommonJS en backend (Node 22) y ESM en frontend (Vite/React 19, ADR 0055). Closes #17. |
| ARC-002 | Completar ADR de persistencia | Alta | terminado | Flujo A | ADR 0034 define SQL directo con pg, importes BIGINT exactos y puertos asíncronos. |
| ARC-003 | Elegir mecanismo de asignación concurrente | Alta | terminado | Flujo A | ADR 0033, índice parcial ux_viaje_chofer_activo y test de 50 aceptaciones concurrentes en ms-viajes/postgres.test.ts. |
| ARC-004 | Elegir geolocalización | Alta | terminado | Flujo B | PR #36 mergeado. ADR 0041 compara PostgreSQL con Haversine, PostGIS y geohash; justifica la opción actual con tres mediciones reproducibles de 500 choferes. |
| ARC-005 | Elegir canal de tiempo real | Media | terminado | Flujo B | Closes #19. ADR 0042 compara polling, SSE y WebSocket; documenta autenticación, autorización, eventos, reconexión y límites de escalado. |
| API-001 | Consolidar contrato HTTP | Alta | terminado | Flujo C | Closes #20. Contrato consolidado en docs/api.md y docs/contratos.md, sobre uniforme de error, códigos de estado alineados, bloqueo de rutas internas en Nginx y prueba en src/e2e.test.ts. |
| SEC-001 | Diseñar autorización por recurso | Alta | terminado | Flujo C | Hay pruebas de acceso permitido y denegado para viajes y ubicaciones. |
| CON-001 | Definir caso de cancelación simultánea | Alta | terminado | Flujo A | Especificado en ADR 0033 y testeado de forma determinista en postgres.test.ts y dominio.test.ts. |
| MED-001 | Diseñar simulador de 500 choferes | Media | terminado | Flujo B | PR #37 mergeado. Tres repeticiones de línea de base por escenario, diagnóstico de memoria con tres repeticiones y comparación con la estrategia final seleccionada en ADR 0041 documentadas en `docs/mediciones.md`. |
| OPS-001 | Definir arranque, readiness y apagado | Alta | terminado | Flujo C | Closes #22. Documentada secuencia de clon limpio en README.md, inicialización automática de esquemas DDL en Compose, readiness con SELECT 1 y graceful shutdown (SIGINT/SIGTERM) en todos los servicios. |
| ARC-006 | Definir limites de microservicios y autenticacion externa | Alta | en progreso | Común | ADR 0016 y contratos compartidos documentan servicios, actor JWT y dependencias. |
| VIA-001 | Implementar dominio inicial de ms-viajes | Alta | terminado | Flujo A | Puertos y casos de uso asíncronos con cobertura completa en dominio.test.ts. |
| MVP-002 | Implementar demo de viaje por terminal | Alta | terminado | Común | Un pasajero o chofer elige rol, informa destino, confirma tarifa, inicia y finaliza un viaje con datos persistidos en memoria y precio final visible. Implementado en `src/viaje.ts` y `src/terminal.ts`, con tests en `src/viaje.test.ts`. |
| MVP-003 | Calcular tarifa con rutas reales | Alta | terminado | Común | La demo usa un proveedor configurable de rutas por calles y calcula el precio con distancia y duración reales; incluye Google Routes API, OSRM y fallback Haversine. |
| MVP-004 | Mostrar recorrido y estimación en una demo web | Baja | terminado | Común | Una página local permite ingresar origen y destino, muestra la ruta, distancia, duración, precio orientativo en ARS y vigencia usando el caso de uso de estimación existente, y simula los estados del viaje sin persistirlo. |
| FLOT-001 | Implementar dominio inicial de ms-flota | Alta | terminado | Flujo B | Disponibilidad, ubicación, candidatos, ocupación y autorización tienen puertos y tests en memoria. |
| FLOT-002 | Integrar adaptador PostgreSQL y esquema inicial | Alta | terminado | Flujo B | PostgreSQL se compone en `ms-flota`, persiste disponibilidad y ubicación actual, aplica actualización condicional y expone readiness con `SELECT 1`. |
| FLOT-003 | Publicar endpoints iniciales de ms-flota | Alta | terminado | Flujo B | Las cuatro rutas están documentadas y protegidas por JWT externo o por el proveedor falso explícito de desarrollo. |
| TAR-001 | Implementar dominio de `ms-tarifas` | Alta | terminado | Flujo C | Closes #24. Dominio puro en `src/ms-tarifas/dominio.ts` con aritmética `BigInt`, límites de multiplicador, vigencia de 3 min y pruebas en `dominio.test.ts`. |
| TAR-002 | Adaptadores de `ms-tarifas` | Alta | terminado | Flujo C | Closes #25. Adaptadores OSRM/Google/Haversine, Open-Meteo, HTTP (`traceparent` + JWT), PostgreSQL (`postgres.test.ts`) y router HTTP (`http.test.ts`). |
| INT-001 | Integrar tarifas, viajes y flota por HTTP | Alta | en progreso | Común | Estimación, demanda, candidatos y ocupación se consultan entre servicios con JWT propagado, timeout, reintento GET limitado y error seguro; falta persistencia y asignación atómica distribuida de viajes. |
| INT-002 | Persistir viajes, ofertas, cobros e idempotencia en PostgreSQL | Alta | terminado | Flujo A | Repositorios PostgreSQL de viajes, ofertas, cobros e idempotencia conectados en servidor.ts y probados en postgres.test.ts. |
| OPS-002 | Completar gateway, JWT y Compose | Alta | terminado | Flujo C | Compose arranca PostgreSQL, los tres procesos y Nginx con healthchecks, DNS interno y proveedores controlados para E2E. |
| OPS-003 | Ejecutar flujo E2E reproducible | Alta | terminado | Común | `npm run test:e2e` y `requests/flujo-e2e.http` cubren estimación, confirmación, ofertas, asignación, estados y cobro. |
| VIA-002 | Publicar API HTTP de ms-viajes | Alta | terminado | Flujo A | Router Express delgado, JWT por puerto, DTOs, errores uniformes, idempotencia y tests HTTP. |
| TIE-001 | WebSockets y tiempo real (Tema 20) | Alta | terminado | Flujo B | Closes #27. `ws` en ms-viajes, ofertas/estados por usuario, cancelación y vencimiento de ofertas, ubicación aproximada, JWT en handshake, autorización por viaje, reconexión con GET y tests automatizados. |
| OBS-001 | Observabilidad con OpenTelemetry y Jaeger (Tema 18) | Alta | terminado | Flujo C | ADR 0050 y `docs/demo-observabilidad.md`. SDK OpenTelemetry en servicios, propagación W3C traceparent y logs correlacionados, y servicio Jaeger en Compose. |
| SEG-002 | Firebase Emulator Suite y RBAC (Tema 19) | Alta | terminado | Flujo C | Closes #28. ADR 0054 y `requests/seguridad-rbac.http`. Emulador JWKS offline en Compose/TypeScript, validación criptográfica asimétrica RS256, RBAC en claims y verificación de 3 escenarios (200/401/403). |
| GEO-001 | Google Maps Rutas y Geocodificación | Media | terminado | Flujo C | Closes #29. Puerto Geocodificador (directa en cascada por cercanía e inversa) y adaptadores Google Maps / Nominatim (OpenStreetMap) / fallback determinista en ms-tarifas y demo web interactiva. ADR 0051, ADR 0052 y ADR 0053. |

| WEB-001 | Núcleo del front: shell, router, cliente API y sesión | Alta | en revisión | Flujo C | Sprint 1 (Fabio, Día 1). Closes #39. Núcleo del front (router, sesión, cliente API y WebSocket) y ADR 0055. Bloquea WEB-004 y WEB-006. Plan en docs/sprint-01.md. |
| OPS-004 | Nginx sirve el front desde el gateway | Alta | pendiente | Flujo C | Sprint 1 (Fabio, Días 1-2). Closes #40. Nginx entrega el front en el mismo origen que la API, con WebSocket y rutas internas bloqueadas. Plan en docs/sprint-01.md. |
| WEB-002 | Login por rol con el emulador de identidad | Alta | pendiente | Flujo C | Sprint 1 (Fabio, Días 1-2). Closes #41. Login por rol con el emulador de identidad, guardas por rol y manejo de token vencido. Plan en docs/sprint-01.md. |
| WEB-003 | Sistema de diseño responsive y accesibilidad | Alta | pendiente | Flujo C | Sprint 1 (Fabio, Días 2-3). Closes #42. Sistema de diseño responsive (360, 768 y 1024 px) y accesibilidad básica. Plan en docs/sprint-01.md. |
| API-002 | Endpoints de Operador/Admin: listado, auditoría de tarifa y regla de demanda | Alta | pendiente | Flujo A | Sprint 1 (Joel, Días 3-5). Closes #43. Listado de viajes, auditoría de tarifa y regla de demanda versionada para Operador/Admin. Plan en docs/sprint-01.md. |
| WEB-008 | Panel de Operador y Administrador | Media | pendiente | Flujo C | Sprint 1 (Fabio, Días 4-6). Closes #44. Panel de Operador y Administrador con auditoría de precio y edición de la regla de demanda. Plan en docs/sprint-01.md. |
| SEG-003 | Entorno para ataque cruzado y hardening del front | Alta | pendiente | Flujo C | Sprint 1 (Fabio, Días 5-7). Closes #45. Entorno reproducible para el ataque cruzado, hardening del front y registro de hallazgos. Plan en docs/sprint-01.md. |
| TEST-001 | E2E Playwright por rol y viewports | Alta | pendiente | Flujo B | Sprint 1 (Valentino, Días 5-7). Closes #46. E2E Playwright por rol y viewports, incluida la reconexión del tiempo real. Plan en docs/sprint-01.md. |
| WEB-004 | Vista del pasajero: estimación con precio dinámico, confirmación y cancelación | Alta | pendiente | Flujo A | Sprint 1 (Joel, Días 2-5). Closes #47. Vista del pasajero con multiplicador visible, precio congelado, idempotencia y cancelación. Plan en docs/sprint-01.md. |
| WEB-005 | Pagos: estado del cobro, recibo, falla y reintento | Alta | pendiente | Flujo A | Sprint 1 (Joel, Días 5-6). Closes #48. Estado del cobro, recibo, falla simulada y reintento idempotente. Plan en docs/sprint-01.md. |
| WEB-006 | Vista del chofer: disponibilidad, ofertas y flujo del viaje | Alta | terminado | Flujo B | Sprint 1 (Valentino, Días 1-4). PR #55 mergeado (Closes #49). Vista del chofer con disponibilidad, ofertas con vencimiento, manejo 409 y avance de estados. Tests E2E en tests/playwright/vista-chofer.spec.ts. |
| WEB-007 | Seguimiento en vivo con WebSocket y reconexión | Alta | terminado | Flujo B | Sprint 1 (Valentino, Días 3-5). PR #58 mergeado (Closes #50). Seguimiento en vivo con WebSocket, reconexión con backoff, recuperación canónica GET /viajes/:id y chofer simulado. E2E Playwright en tests/playwright/tiempo-real-seguimiento.spec.ts. |
| MED-002 | Mediciones finales de carga: 3 repeticiones por escenario | Alta | en revisión | Flujo B | Sprint 1 (Valentino, Días 3-6). Closes #51. Tres repeticiones por escenario con comparación antes y después de optimizar consolidadas en docs/mediciones.md. |
| FAL-001 | Pruebas de falla de dependencias y recuperación | Media | pendiente | Flujo B | Sprint 1 (Valentino, Días 6-7). Closes #52. Pruebas de servicio caído, timeout y recuperación con trazas en Jaeger. Plan en docs/sprint-01.md. |
| DOC-001 | Informe, guion de demo y verificación de clon limpio | Alta | pendiente | Flujo A | Sprint 1 (Joel, Día 7). Closes #53. Informe, guion de demo y verificación de clon limpio por otra persona. Plan en docs/sprint-01.md. |

## Regla de actualización

Cada tarea debe tener un único estado visible y enlazar, cuando exista, al documento, ADR, test o pull request que demuestra su avance.
