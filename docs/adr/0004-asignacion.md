# ADR 0004: Mecanismo de asignación atómica de viaje y chofer

- Estado: propuesto
- Fecha: 2026-09-23
- Participantes: Echeverría Maximiliano Joel, Borchichi Valentino, Navarro Fabio

## Contexto

Un viaje debe tener un solo chofer y un chofer un solo viaje activo, incluso ante al menos cincuenta aceptaciones concurrentes y una cancelación simultánea. Debe evitarse también el interbloqueo al proteger ambos recursos.

## Opciones consideradas

### Transacción con bloqueo pesimista ordenado

Ventajas: expresa directamente la exclusión de los recursos y permite resolver la aceptación dentro de una transacción.

Desventajas: retiene locks, exige un orden global y puede reducir concurrencia si la transacción es demasiado grande.

### Control optimista con versión y restricciones únicas

Ventajas: reduce bloqueos prolongados y hace explícito el conflicto de versión.

Desventajas: bajo mucha contención produce reintentos; las dos invariantes y el estado de cancelación deben quedar cubiertas por restricciones y una transacción.

## Decisión

Pendiente de validar con un prototipo y el test de cincuenta aceptaciones. El ADR definitivo debe indicar qué recursos se bloquean, en qué orden y qué respuesta reciben los perdedores.

## Consecuencias

La asignación no podrá contener llamadas externas ni trabajo innecesario dentro de la transacción. El test concurrente será una evidencia obligatoria, no solo un test de caso feliz.

## Qué nos haría cambiar de decisión

Deadlocks reproducibles, latencia inaceptable bajo la carga objetivo o imposibilidad de expresar las invariantes con garantías de base de datos.
