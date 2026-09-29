# Backlog inicial

Estados permitidos: `pendiente`, `en progreso`, `bloqueado`, `en revisión`, `terminado`.

| ID | Trabajo | Prioridad | Estado | Criterio de aceptación |
|---|---|---:|---|---|
| MVP-001 | Definir el recorrido mínimo demostrable | Alta | terminado | `docs/alcance-minimo.md` describe el flujo, los endpoints, los soportes necesarios y el criterio de aceptación sin reducir requisitos del enunciado. |
| DOM-001 | Documentar variante A: precio dinámico por demanda | Alta | terminado | La variante está registrada en AGENTS, modelo, API y backlog. |
| DOM-003 | Definir regla configurable de precio dinámico | Alta | pendiente | Se acuerdan fórmula, pesos, límites y ejemplos para disponibilidad, demanda por zona, lluvia y franja horaria; la demanda creciente sube y la decreciente baja el componente de demanda. |
| DOM-004 | Congelar precio al confirmar | Alta | pendiente | Una estimación vence a los 3 minutos; confirmar una vigente conserva exactamente el precio visto pese a cambios posteriores de factores. |
| DOM-005 | Resolver carrera entre recálculo y confirmación | Alta | pendiente | Un test concurrente demuestra que nunca se confirma un precio distinto al aceptado. |
| DOM-006 | Registrar evidencia de cálculo dinámico | Alta | pendiente | Cada viaje guarda precio ARS confirmado, versión de regla y los datos usados de disponibilidad, demanda, lluvia y franja horaria. |
| DOM-007 | Elegir fuente del dato de lluvia | Alta | pendiente | ADR compara permiso de uso, disponibilidad, resolución, límites y costo; el adaptador registra fuente y fecha del dato y tiene alternativa de prueba. |
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
