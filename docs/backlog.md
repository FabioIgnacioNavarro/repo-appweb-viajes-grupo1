# Backlog inicial

Estados permitidos: `pendiente`, `en progreso`, `bloqueado`, `en revisión`, `terminado`.

| ID | Trabajo | Prioridad | Estado | Criterio de aceptación |
|---|---|---:|---|---|
| MVP-001 | Definir el recorrido mínimo demostrable | Alta | terminado | `docs/alcance-minimo.md` describe el flujo, los endpoints, los soportes necesarios y el criterio de aceptación sin reducir requisitos del enunciado. |
| DOM-001 | Documentar variante A: precio dinámico por demanda | Alta | terminado | La variante está registrada en AGENTS, modelo, API y backlog. |
| DOM-003 | Definir regla configurable de precio dinámico | Alta | en revisión | ADR 0021 documenta una regla inicial configurable por versión, importes exactos y límites; requiere validación del equipo. |
| DOM-004 | Congelar precio al confirmar | Alta | en progreso | Dominio de viajes ya congela importe y factores; falta integración HTTP y persistente con tarifas. |
| DOM-005 | Resolver carrera entre recálculo y confirmación | Alta | pendiente | Un test concurrente demuestra que nunca se confirma un precio distinto al aceptado. |
| DOM-006 | Registrar evidencia de cálculo dinámico | Alta | en progreso | Tarifas guarda un snapshot auditable; falta persistirlo junto al viaje confirmado. |
| DOM-007 | Elegir fuente del dato de lluvia | Alta | en revisión | ADR 0008 acepta Open-Meteo para el prototipo académico; el adaptador aplica caché y rechaza observaciones vencidas. |
| DOM-002 | Cerrar estados y transiciones del viaje | Alta | en progreso | Cada transición válida e inválida está documentada y testeada. |
| ARC-001 | Completar ADR de módulos | Alta | en progreso | La decisión CommonJS/ESM queda aceptada y reproducida desde clon limpio. |
| ARC-002 | Completar ADR de persistencia | Alta | en progreso | PostgreSQL y estrategia de acceso a datos tienen alternativas y consecuencias. |
| ARC-003 | Elegir mecanismo de asignación concurrente | Alta | pendiente | Cincuenta aceptaciones concurrentes dejan exactamente un ganador. |
| ARC-004 | Elegir geolocalización | Alta | pendiente | Se comparan al menos dos opciones y se define política de retención. |
| ARC-005 | Elegir canal de tiempo real | Media | pendiente | El canal y la recuperación tras reconexión están documentados. |
| API-001 | Consolidar contrato HTTP | Alta | pendiente | Endpoints, códigos, errores, autenticación e idempotencia están definidos. |
| SEC-001 | Diseñar autorización por recurso | Alta | pendiente | Hay pruebas de acceso permitido y denegado para viajes y ubicaciones. |
| CON-001 | Definir caso de cancelación simultánea | Alta | pendiente | El resultado de carrera está especificado y testeado. |
| MED-001 | Diseñar simulador de 500 choferes | Media | pendiente | Se puede ejecutar carga sostenida y medir p50, p95, p99, lag y memoria. |
| OPS-001 | Definir arranque, readiness y apagado | Alta | pendiente | La secuencia de clon limpio queda documentada y verificable. |
| ARC-006 | Definir limites de microservicios y autenticacion externa | Alta | en progreso | ADR 0016 y contratos compartidos documentan servicios, actor JWT y dependencias. |
| VIA-001 | Implementar dominio inicial de ms-viajes | Alta | en progreso | Estados, confirmacion, ofertas, asignacion, cancelacion, finalizacion y cobro tienen puertos y tests. |
| MVP-002 | Implementar demo de viaje por terminal | Alta | terminado | Un pasajero o chofer elige rol, informa destino, confirma tarifa, inicia y finaliza un viaje con datos persistidos en memoria y precio final visible. Implementado en `src/viaje.ts` y `src/terminal.ts`, con tests en `src/viaje.test.ts`. |
| MVP-003 | Calcular tarifa con rutas reales | Alta | terminado | La demo usa un proveedor configurable de rutas por calles y calcula el precio con distancia y duración reales; incluye Google Routes API, OSRM y fallback Haversine. |
| MVP-004 | Mostrar recorrido y estimación en una demo web | Baja | terminado | Una página local permite ingresar origen y destino, muestra la ruta, distancia, duración, precio orientativo en ARS y vigencia usando el caso de uso de estimación existente, y simula los estados del viaje sin persistirlo. |
| FLOT-001 | Implementar dominio inicial de ms-flota | Alta | terminado | Disponibilidad, ubicación, candidatos, ocupación y autorización tienen puertos y tests en memoria. |
| FLOT-002 | Integrar adaptador PostgreSQL y esquema inicial | Alta | terminado | PostgreSQL se compone en `ms-flota`, persiste disponibilidad y ubicación actual, aplica actualización condicional y expone readiness con `SELECT 1`. |
| FLOT-003 | Publicar endpoints iniciales de ms-flota | Alta | terminado | Las cuatro rutas están documentadas y protegidas por JWT externo o por el proveedor falso explícito de desarrollo. |
| TAR-001 | Implementar dominio de `ms-tarifas` | Alta | en progreso | Dominio y pruebas cubren fórmula inicial, factores, BigInt, auditoría y vigencia; falta validar política y conectar extremos. |
| TAR-002 | Adaptadores de `ms-tarifas` | Alta | en progreso | Existen adaptadores OSRM/Google/Haversine, clima y PostgreSQL; falta ejecutar integración con servicios reales y Compose. |
| INT-001 | Integrar tarifas, viajes y flota por HTTP | Alta | en progreso | Estimación, demanda, candidatos y ocupación se consultan entre servicios con JWT propagado, timeout, reintento GET limitado y error seguro; falta persistencia y asignación atómica distribuida de viajes. |
| INT-002 | Persistir viajes, ofertas, cobros e idempotencia en PostgreSQL | Alta | pendiente | Los casos HTTP usan repositorios PostgreSQL y transacciones que preservan idempotencia y una sola asignación por viaje/chofer entre instancias. |
| OPS-002 | Completar gateway, JWT y Compose | Alta | en progreso | Compose valida, arranca los tres procesos, PostgreSQL y Nginx; flota/tarifas comprueban PostgreSQL, pero `ms-viajes` todavía no persiste y su readiness no está completa. |
| VIA-002 | Publicar API HTTP de ms-viajes | Alta | terminado | Router Express delgado, JWT por puerto, DTOs, errores uniformes, idempotencia y tests HTTP. |

## Regla de actualización

Cada tarea debe tener un único estado visible y enlazar, cuando exista, al documento, ADR, test o pull request que demuestra su avance.
