# Backlog inicial

Estados permitidos: `pendiente`, `en progreso`, `bloqueado`, `en revisión`, `terminado`.

| ID | Trabajo | Prioridad | Estado | Criterio de aceptación |
|---|---|---:|---|---|
| DOM-001 | Documentar variante A: precio dinámico por demanda | Alta | terminado | La variante está registrada en AGENTS, modelo, API y backlog. |
| DOM-003 | Definir regla configurable de demanda por zona | Alta | pendiente | La regla tiene entradas, fórmula, límites y ejemplos auditables. |
| DOM-004 | Congelar multiplicador al confirmar | Alta | pendiente | El precio aceptado no cambia aunque la demanda varíe durante el viaje. |
| DOM-005 | Resolver carrera entre recálculo y confirmación | Alta | pendiente | Un test concurrente demuestra que nunca se confirma un precio distinto al aceptado. |
| DOM-006 | Registrar evidencia de cálculo dinámico | Alta | pendiente | Cada viaje guarda multiplicador, versión y datos resumidos de demanda. |
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

## Regla de actualización

Cada tarea debe tener un único estado visible y enlazar, cuando exista, al documento, ADR, test o pull request que demuestra su avance.
