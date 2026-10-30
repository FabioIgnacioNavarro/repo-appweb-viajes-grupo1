# ADR 0033: Asignación concurrente con bloqueo ordenado e índice único parcial

- Estado: propuesto
- Fecha: 2026-10-30
- Participantes: Borchichi Valentino (Flujo A); pendiente de revisión del grupo
- Completa al ADR 0004, que dejó la decisión abierta hasta tener un prototipo.

## Contexto

La invariante central del proyecto es que un viaje activo tiene un solo chofer y un chofer no tiene
más de un viaje activo. Hoy `AsignadorAtomicoMemoria` la cumple solo dentro de un único proceso de
Node.js: con dos réplicas de `ms-viajes`, o tras un reinicio, el estado se pierde o se contradice.

Las operaciones que compiten son:

- Cincuenta o más choferes aceptan ofertas del mismo viaje a la vez.
- Un chofer acepta ofertas de dos viajes distintos a la vez.
- El pasajero (o soporte) cancela mientras un chofer acepta.
- Un mismo reintento de confirmación llega dos veces en paralelo (ver ADR 0035).

Los viajes activos son `ASIGNADO`, `CHOFER_EN_CAMINO` y `EN_CURSO` (glosario y ADR 0019).
PostgreSQL es la fuente de verdad (ADR 0026) y las transacciones no pueden contener llamadas HTTP a
otros servicios (ADR 0022 y 0023).

## Opciones consideradas

### Opción A: bloqueo pesimista de la fila del viaje más índice único parcial

La aceptación abre una transacción, bloquea la fila del viaje con `SELECT ... FOR UPDATE`, valida
estados y vencimiento, y asigna. Un índice único parcial sobre `viaje(chofer_usuario_id)` limitado a
los estados activos impide por sí solo que un chofer tenga dos viajes activos.

Ventajas reales:

- Las dos invariantes quedan garantizadas por la base y no dependen de que el código sea correcto.
- Cancelar y aceptar se serializan sobre la misma fila, así el resultado siempre es uno de los dos
  órdenes posibles y ambos son estados válidos.
- Los perdedores ven el estado ya cambiado y reciben un rechazo claro, sin reintentos.

Desventajas reales:

- Retiene un lock de fila durante la transacción; si esta se alarga, baja la concurrencia.
- Exige respetar siempre el mismo orden de bloqueo en todos los casos de uso.
- Las cincuenta aceptaciones se encolan una detrás de otra en lugar de fallar rápido.

### Opción B: control optimista con columna de versión

Cada `UPDATE` incluye `WHERE id = $1 AND version = $2`; si afecta cero filas, hubo un conflicto.

Ventajas reales:

- No retiene locks durante la lógica del caso de uso.
- El conflicto es explícito y fácil de testear.

Desventajas reales:

- Bajo mucha contención (50 aceptaciones simultáneas) casi todos los intentos fallan y hay que
  decidir cuántos reintentos hacer.
- Solo protege la fila del viaje; "un chofer, un viaje activo" sigue necesitando un índice único.
- Más código de reintento en el caso de uso, que ensucia el dominio.

### Opción C: solo restricciones únicas, sin bloqueos explícitos

Se confía en que el índice único parcial rechace al perdedor con `23505`.

Ventajas reales:

- Es la solución más simple y sin riesgo de deadlock.

Desventajas reales:

- No cubre la carrera entre cancelar y aceptar: ambas pueden leer el estado `SOLICITADO` y luego
  escribir, dejando un viaje cancelado con chofer o un chofer ocupado sin viaje.
- Los errores de base se usarían como flujo de control para casos que sí se pueden prever.

### Opción D: advisory locks (`pg_advisory_xact_lock`)

Ventajas reales:

- Permite bloquear por una clave arbitraria (por ejemplo el chofer) sin tocar filas.

Desventajas reales:

- El bloqueo no está ligado a datos reales y es fácil olvidarlo en un caso de uso nuevo.
- Es una herramienta menos conocida por el grupo y más difícil de defender y depurar.

## Decisión

Se elige la **Opción A**, apoyada por la restricción de la Opción C como red de seguridad.

1. **Índice único parcial** sobre `viaje(chofer_usuario_id) WHERE estado IN ('ASIGNADO',
   'CHOFER_EN_CAMINO','EN_CURSO')`. Si dos transacciones intentan asignar el mismo chofer, la
   segunda recibe `23505` y el adaptador lo traduce a `ASIGNACION_EN_CONFLICTO`.
2. **Orden único de bloqueo**: en todo caso de uso que modifique un viaje se bloquea primero la fila
   de `viaje` y recién después, si hace falta, las filas de `oferta` de ese mismo viaje. Nunca se
   bloquea una oferta antes que su viaje. Como cada transacción toca una sola fila de `viaje`, no
   se forma un ciclo de espera y el deadlock no puede producirse.
3. **Aceptar**: bloquea el viaje, lee y bloquea la oferta, comprueba que la oferta pertenezca al
   chofer, esté `PENDIENTE` y no haya vencido, y que el viaje siga `SOLICITADO`. Luego pasa el viaje
   a `ASIGNADO`, la oferta a `ACEPTADA` y las demás ofertas del viaje a `NO_SELECCIONADA`.
4. **Cancelar, avanzar y finalizar**: bloquean el viaje primero, igual que aceptar.
5. **Aislamiento**: se mantiene `READ COMMITTED` (el predeterminado). Con `FOR UPDATE`, la segunda
   transacción espera y, al obtener el lock, relee la fila ya confirmada, así que no hace falta
   `SERIALIZABLE` ni reintentos.
6. **Respuesta a los perdedores**: no se reintenta. Reciben `409` con el código estable que describe
   la causa: `VIAJE_NO_DISPONIBLE` si el viaje ya no está `SOLICITADO` (otro chofer ganó o fue
   cancelado), `ASIGNACION_EN_CONFLICTO` si el chofer ya tiene un viaje activo, y `OFERTA_VENCIDA`
   o `OFERTA_NO_DISPONIBLE` según corresponda.
7. **Transacción corta**: dentro de la transacción solo hay consultas SQL. Las llamadas HTTP a
   `ms-flota` y `ms-tarifas` se hacen antes de abrirla o después de cerrarla.

## Consecuencias

- Qué gana el sistema: la invariante central vale entre réplicas y reinicios, y la carrera entre
  cancelar y aceptar queda resuelta de forma determinista.
- Qué pierde: las aceptaciones simultáneas sobre el mismo viaje se serializan; con 50 choferes por
  viaje el costo es de milisegundos y se verificará con los tests.
- Qué queda más difícil: todo caso de uso nuevo que toque viajes debe seguir el orden de bloqueo.
  Se documenta aquí y se cubre con tests de concurrencia para detectar regresiones.
- El puerto `AsignadorAtomico` actual (síncrono y en memoria) se reemplaza por operaciones de
  repositorio transaccionales; el adaptador en memoria se conserva para los tests unitarios.

## Qué nos haría cambiar de decisión

Deadlocks reproducibles en los tests de concurrencia, una latencia de aceptación que no cumpla el
objetivo medido por el Flujo B con 500 choferes, o la necesidad de repartir los viajes entre varias
bases de datos, caso en el que el bloqueo de fila dejaría de bastar.
